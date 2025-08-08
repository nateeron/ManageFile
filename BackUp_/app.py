import os
import platform
import string
from flask import Flask, render_template, request,send_file,abort,jsonify,Response,send_from_directory
import zipfile
from flask_socketio import SocketIO
import concurrent.futures
import time
import shutil
from PIL import Image
import io


app = Flask(__name__, template_folder="templates")
socketio = SocketIO(app, cors_allowed_origins="*") 
def check_System():
    system_info = platform.system()

    if system_info == "Windows":
        # List all available drives (C:, D:, E:, etc.)
        drives = [f"{d}:/" for d in string.ascii_uppercase if os.path.exists(f"{d}:/")]
        return drives  # Return list of drives
    elif system_info == "Linux":
        if "Android" in platform.uname():  # Checking for Android system
            return ["/storage/emulated/0"]  # Android Internal Storage
        else:
            # For Ubuntu/Linux, list all mounted file systems
            mounts = []
            with os.popen('mount -v') as f:
                for line in f.readlines():
                    if "on" in line:  # Identify mount points
                        parts = line.split()
                        mounts.append(parts[2])  # The mount point is the third element
            return mounts
    else:
        return [os.getcwd()]  # Default to current working directory

@app.route('/')
def index():
      drives = check_System()
      
      # Get selected path (default to first drive if available)
      selected_path = request.args.get('path', drives[0] if drives else None)

      folders, files = [], []
      if selected_path and os.path.exists(selected_path):
            folders = [f for f in os.listdir(selected_path) if os.path.isdir(os.path.join(selected_path, f))]
            files = [f for f in os.listdir(selected_path) if os.path.isfile(os.path.join(selected_path, f))]
            file_types = {f: f.split('.')[-1] if '.' in f else 'Unknown' for f in files}
            print("File types:", file_types)
            
      return render_template("index.html", system_path=selected_path, drives=drives, folders=folders, files=files,file_types=file_types)

@app.route('/download_folders', methods=['POST'])
def download_folders():
    data = request.get_json()
    folder_name_arr = data.get('folders', [])
    FILES_DIR = data.get('system_path', "")
    try:
    
        if not folder_name_arr or not FILES_DIR:
            return jsonify({"error": "Invalid request. Missing required parameters"}), 400

        # Ensure the ZIP filename is correctly formatted
        folder_name = "DownLoad_byManageFile"#.join(folder_name_arr)
        zip_path = os.path.join(FILES_DIR, f"{folder_name}.zip")

        def zip_folder_with_progress():
            total_files = 0
            completed_files = 0

            # Calculate total files before zipping
            for lisFile in folder_name_arr:
                folder_path = os.path.join(FILES_DIR, lisFile)

                # **Security Check: Ensure the folder is inside FILES_DIR**
                folder_path = os.path.abspath(folder_path)

                if not os.path.exists(folder_path):
                    return jsonify({"error": f"Folder '{lisFile}' not found"}), 404
                if os.path.isfile(folder_path):
                    total_files += 1
                elif os.path.isdir(folder_path):
                    total_files += sum(len([f for f in files if os.path.isfile(os.path.join(root, f))])
                                                for root, _, files in os.walk(folder_path))

            if total_files == 0:
                return jsonify({"error": "No files to zip"}), 400

            # Start zipping with progress tracking
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for lisFile in folder_name_arr:
                    file_path = os.path.join(FILES_DIR, lisFile)
                    if os.path.isfile(file_path):  # ZIP a single file
                        arcname = os.path.relpath(file_path, FILES_DIR)
                        zipf.write(file_path, arcname)

                        completed_files += 1
                        progress = int((completed_files / total_files) * 100)
                        socketio.emit("zip_progress", {"progress": progress})
                        
                        
                    elif os.path.isdir(file_path):     
                        for root, _, files in os.walk(file_path):
                            for file in files:
                                full_file_path  = os.path.join(root, file)
                                arcname = os.path.relpath(full_file_path , FILES_DIR)  # Keep full folder structure
                                zipf.write(full_file_path , arcname)

                                completed_files += 1
                                progress = int((completed_files / total_files) * 100)
                                socketio.emit("zip_progress", {"progress": progress})

            return {"zip_file": f"{folder_name}.zip"}

        # Run zipping asynchronously
        with concurrent.futures.ThreadPoolExecutor() as executor:
            result = executor.submit(zip_folder_with_progress).result()

        return jsonify(result)
    except Exception as e:
      print('Error:',e)
      return {"Error": e}

def send_file_partial(file_path, filename):
    file_size = os.path.getsize(file_path)
    range_header = request.headers.get('Range')

    if range_header:
        byte_start, byte_end = parse_range_header(range_header, file_size)
        length = byte_end - byte_start + 1

        def generate():
            with open(file_path, "rb") as f:
                f.seek(byte_start)
                while length > 0:
                    chunk = f.read(min(8 * 1024 * 1024, length))  # 8MB chunks
                    if not chunk:
                        break
                    length -= len(chunk)
                    yield chunk

        response = Response(generate(), status=206, content_type="application/octet-stream")
        response.headers["Content-Range"] = f"bytes {byte_start}-{byte_end}/{file_size}"
    else:
        response = send_file(file_path, as_attachment=True)

    response.headers["Accept-Ranges"] = "bytes"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response

def parse_range_header(range_header, file_size):
    try:
        byte_range = range_header.split("=")[1]
        byte_start, byte_end = byte_range.split("-")

        byte_start = int(byte_start) if byte_start else 0
        byte_end = int(byte_end) if byte_end else file_size - 1

        return max(0, byte_start), min(byte_end, file_size - 1)
    except:
        return 0, file_size - 1

def safe_delete(file_path):
    """Safely deletes a file, checking for errors."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"Deleted ZIP file: {file_path}")
    except Exception as e:
        print(f"Error deleting ZIP file: {e}")
        
@app.route('/download/<zip_name>')
def download(zip_name):
    pathfile = request.args.get('path')  # Get path from query param
    if not pathfile:
        return abort(400, "Missing file path")
    zip_path = os.path.join(pathfile, zip_name)
    
    return send_file_partial(zip_path,zip_name)
    #return send_file(zip_path, as_attachment=True)

def zip_folder(folder_path, zip_path):
    """Zips a folder into a ZIP archive."""
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, os.path.dirname(folder_path))
                zipf.write(file_path, arcname)
                
@app.route('/download2', methods=['GET'])
def download2():
    path = request.args.get("path")  # Get file/folder path from request
    if not path or not os.path.exists(path):
        return {"error": "Invalid path"}, 400

    delete_after_download = False  # Flag to track if ZIP should be deleted

    if os.path.isdir(path):
        zip_path = path + ".zip"
        zip_folder(path, zip_path)
        file_path = zip_path
        filename = os.path.basename(zip_path)
        delete_after_download = True  # Mark for deletion
    else:
        file_path = path
        filename = os.path.basename(path)

    try:
        response = send_file(file_path, as_attachment=True)

        # ✅ Only delete ZIP after a successful download
        if delete_after_download:
            response.direct_passthrough = False  # Ensure file isn't locked
            response.call_on_close(lambda: safe_delete(zip_path))

        return response
    except Exception as e:
        print(f"Download error: {e}")
        return {"error": "Failed to download file"}, 500


@app.route("/upload/", methods=["POST"])
def upload_files():
    
    if "files" not in request.files:
        return jsonify({"message": "No files received"}), 400

    files = request.files.getlist("files")
    system_path = request.form.get("system_path", "")

    print("***********************************")
    print(files)
    if "files" not in request.files:
        return jsonify({"message": "No files received"}), 400

    files = request.files.getlist("files")
    print(files)
    print("***********************************")
    print(system_path)
    total_files = len(files)
    saved_files = []

    if total_files == 0:
        return jsonify({"message": "No files selected"}), 400

    for index, file in enumerate(files):
        if file.filename == "":
            continue  # Skip empty filenames

        # Preserve folder structure from input
        file_path = os.path.join(system_path, file.filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)  # Ensure directories exist
        file.save(file_path)

        saved_files.append(file.filename)

        # Emit real-time progress update
        progress = int(((index + 1) / total_files) * 100)
        socketio.emit("upload_progress", {"progress": progress, "file": file.filename})
    saved_files = []
    print("end***********************************")
    return jsonify({"message": "Files uploaded successfully", "files": saved_files})


@app.route('/delete', methods=['POST'])
def delete_path():
    """API to delete a file or folder."""
    print("Delete")
    data = request.get_json()
    folder_name_arr = data.get('folders', [])
    FILES_DIR = data.get('system_path', "")
    print(folder_name_arr)
    print(FILES_DIR)
    listP = []
    try:
        for lisFile in folder_name_arr:
            path = os.path.join(FILES_DIR, lisFile)
            print(path)
            
            listP.append(path)
            if os.path.isfile(path):
                os.remove(path)
            elif os.path.isdir(path):
                shutil.rmtree(path)
            else:
                return jsonify({"error": "Unknown type"}), 400
        allpath = ','.join(listP)
        return jsonify({"message": f"Folder deleted: {allpath}"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    
@app.route('/create_folder', methods=['POST'])
def create_folder():
    """API to create a new folder."""
    data = request.get_json()

    # Get the system path and folder name from the request
    system_path = data.get('system_path')
    folder_name = data.get('folder_name')

    if not system_path or not folder_name:
        return jsonify({"error": "Missing required parameters: 'system_path' and 'folder_name'"}), 400

    # Construct the full folder path
    folder_path = os.path.join(system_path, folder_name)

    try:
        # Create the folder if it doesn't exist
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)
            return jsonify({"message": f"Folder '{folder_name}' created at {folder_path}"}), 200
        else:
            return jsonify({"error": f"Folder '{folder_name}' already exists at {folder_path}"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route('/image_view/<filename>')
def image_view(filename):
    path_param = request.args.get('path')

    return send_from_directory(path_param, filename)

@app.route('/getimage/<filename>')
def getimage(filename):
    path_param = request.args.get('path')
    file_path = os.path.join(path_param, filename)

    # Open and compress the image using Pillow
    img = Image.open(file_path)
    img = img.convert("RGB")
    img = img.resize((200, 200))  # Resize for optimization (example)
    
    # Save the image to a BytesIO object
    img_io = io.BytesIO()
    img.save(img_io, 'JPEG', quality=65)  # Adjust quality for compression
    img_io.seek(0)

    return send_file(img_io, mimetype='image/jpeg')


if __name__ == '__main__':
    # app.run(debug=True, host="0.0.0.0", port=1298)
    #socketio.run(app, debug=True, host="0.0.0.0", port=80)
    socketio.run(app, host="0.0.0.0", port=1298, debug=True ,allow_unsafe_werkzeug=True)
# python -m flask run --host=0.0.0.0 --port=1298 --debug



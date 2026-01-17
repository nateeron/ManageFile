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

def is_windows_system():
    """Check if the server is running on Windows based on actual system characteristics."""
    # Check multiple indicators for Windows
    return (platform.system() == "Windows" or 
            os.name == 'nt' or 
            os.sep == '\\' or
            (hasattr(os, 'path') and os.path.sep == '\\'))

def check_System():
    system_info = platform.system()
    print(system_info)
    # Use helper function to check Windows based on actual system
    if is_windows_system():
        # List all available drives (C:, D:, E:, etc.)
        drives = [f"{d}:/" for d in string.ascii_uppercase if os.path.exists(f"{d}:/")]
        return drives  # Return list of drives
    elif system_info == "Linux":
        if "Linux" in platform.system() and "Ubuntu" not in platform.version():  # Checking for Android system
            print("Android /storage/emulated/0")
            return ["/storage/emulated/0"]  # Android Internal Storage
        else:
            # For Ubuntu/Linux, list all mounted file systems
            mounts = []
            with os.popen('mount -v') as f:
                for line in f:
                    if "on" in line:  # Identify mount points
                        parts = line.split()
                        print(parts)
                        mounts.append(parts[2])  # The mount point is the third element
            return mounts
    else:
        return [os.getcwd()]  # Default to current working directory

@app.route('/')
def index():
    drives = check_System()
    
    # Get selected path (default to first drive or user home)
    selected_path = request.args.get('path', drives[0] if drives else os.path.expanduser("~"))

    folders, files, file_types = [], [], {}
    if selected_path and os.path.exists(selected_path) and os.path.isdir(selected_path):
        try:
            folders = [f for f in os.listdir(selected_path) if os.path.isdir(os.path.join(selected_path, f))]
            files = [f for f in os.listdir(selected_path) if os.path.isfile(os.path.join(selected_path, f))]
            folders.sort()
            files.sort()
            file_types = {f: f.split('.')[-1] if '.' in f else 'Unknown' for f in files}
            print("File types:", file_types)
        except PermissionError:
            folders, files, file_types = [], [], {}
    
    return render_template("index.html", system_path=selected_path, drives=drives,
                           folders=folders, files=files, file_types=file_types)
    
    
    
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

@app.route('/create_file', methods=['POST'])
def create_file():
    """API to create a new empty file."""
    data = request.get_json()
    
    system_path = data.get('system_path')
    file_name = data.get('file_name')
    
    if not system_path or not file_name:
        return jsonify({"error": "Missing required parameters: 'system_path' and 'file_name'"}), 400
    
    try:
        # Normalize and clean paths
        system_path = os.path.normpath(system_path)
        file_name = file_name.strip()
        
        # Validate file name for invalid characters (OS-specific based on server deployment)
        if is_windows_system():
            invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
        else:  # Linux/Unix
            invalid_chars = ['/', '\0']  # / is path separator, \0 is null character
            # Also check for reserved names on Linux
            reserved_names = ['', '.', '..']
            if file_name in reserved_names:
                return jsonify({"error": f"'{file_name}' is a reserved name"}), 400
        
        if any(char in file_name for char in invalid_chars):
            return jsonify({"error": f"Invalid characters in file name: {', '.join(invalid_chars)}"}), 400
        
        # Construct the full file path using os.path.join for cross-platform compatibility
        file_path = os.path.join(system_path, file_name)
        
        # Normalize the path to handle any double separators or issues
        file_path = os.path.normpath(file_path)
        
        # Security check: ensure the file is inside system_path
        file_path_abs = os.path.abspath(file_path)
        system_path_abs = os.path.abspath(system_path)
        
        if not file_path_abs.startswith(system_path_abs):
            return jsonify({"error": f"Access denied: File path must be within system_path. Attempted: {file_path_abs}, System path: {system_path_abs}"}), 403
        
        # Ensure parent directory exists
        parent_dir = os.path.dirname(file_path_abs)
        if not os.path.exists(parent_dir):
            try:
                os.makedirs(parent_dir, exist_ok=True)
            except Exception as e:
                return jsonify({"error": f"Cannot create parent directory: {str(e)}"}), 500
        
        # Check if file already exists
        if os.path.exists(file_path_abs):
            return jsonify({"error": f"File '{file_name}' already exists at {file_path_abs}"}), 400
        
        # Create empty file
        with open(file_path_abs, 'w', encoding='utf-8') as f:
            pass  # Create empty file
        
        return jsonify({"message": f"File '{file_name}' created successfully at {file_path_abs}"}), 200
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return jsonify({"error": f"{str(e)}\n\nDetails:\n{error_details}"}), 500

@app.route('/rename', methods=['POST'])
def rename_path():
    """API to rename a file or folder. Works on both Linux and Windows."""
    data = request.get_json()
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    system_path = data.get('system_path')
    
    if not old_name or not new_name or not system_path:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    
    # Construct full paths
    old_path = os.path.join(system_path, old_name)
    new_path = os.path.join(system_path, new_name)
    
    # Security check: ensure paths are within system_path
    old_path = os.path.abspath(old_path)
    new_path = os.path.abspath(new_path)
    system_path_abs = os.path.abspath(system_path)
    
    if not old_path.startswith(system_path_abs) or not new_path.startswith(system_path_abs):
        return jsonify({"success": False, "error": "Access denied"}), 403
    
    try:
        # Check if old path exists
        if not os.path.exists(old_path):
            return jsonify({"success": False, "error": "File or folder not found"}), 404
        
        # Check if new name already exists
        if os.path.exists(new_path):
            return jsonify({"success": False, "error": f"'{new_name}' already exists"}), 400
        
        # Validate new name (prevent invalid characters)
        invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
        if any(char in new_name for char in invalid_chars):
            return jsonify({"success": False, "error": f"Invalid characters in name: {', '.join(invalid_chars)}"}), 400
        
        # Rename using os.rename() - works on both Linux and Windows
        os.rename(old_path, new_path)
        
        return jsonify({"success": True, "message": f"Renamed '{old_name}' to '{new_name}'"}), 200
        
    except OSError as e:
        return jsonify({"success": False, "error": f"OS error: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/copy', methods=['POST'])
def copy_files():
    """API to copy files and folders. Works on both Linux and Windows."""
    data = request.get_json()
    source_path = data.get('source_path')
    items = data.get('items', [])  # List of file/folder names (may include renamed items)
    destination_path = data.get('destination_path')
    overwrite = data.get('overwrite', False)  # Whether to overwrite existing files
    
    if not source_path or not items or not destination_path:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    
    # Security check
    source_path_abs = os.path.abspath(source_path)
    destination_path_abs = os.path.abspath(destination_path)
    
    copied_items = []
    errors = []
    
    for item_name in items:
        try:
            # Get original name from source (item_name might be renamed)
            # For now, assume item_name matches source name
            source_item_path = os.path.join(source_path, item_name)
            destination_item_path = os.path.join(destination_path, item_name)
            
            # Security check
            source_item_path = os.path.abspath(source_item_path)
            destination_item_path = os.path.abspath(destination_item_path)
            
            if not source_item_path.startswith(source_path_abs):
                errors.append(f"Access denied: {item_name}")
                continue
            
            if not os.path.exists(source_item_path):
                errors.append(f"Not found: {item_name}")
                continue
            
            # Check if destination exists
            if os.path.exists(destination_item_path) and not overwrite:
                errors.append(f"Already exists: {item_name}")
                continue
            
            # Copy file or folder
            if os.path.isfile(source_item_path):
                if os.path.exists(destination_item_path) and overwrite:
                    os.remove(destination_item_path)
                shutil.copy2(source_item_path, destination_item_path)
            elif os.path.isdir(source_item_path):
                if os.path.exists(destination_item_path) and overwrite:
                    shutil.rmtree(destination_item_path)
                shutil.copytree(source_item_path, destination_item_path, dirs_exist_ok=True)
            
            copied_items.append(item_name)
            
        except Exception as e:
            errors.append(f"Error copying {item_name}: {str(e)}")
    
    if errors:
        return jsonify({"success": True, "copied": copied_items, "errors": errors}), 200
    else:
        return jsonify({"success": True, "copied": copied_items, "message": "All items copied successfully"}), 200

@app.route('/move', methods=['POST'])
def move_files():
    """API to move (cut) files and folders. Works on both Linux and Windows."""
    data = request.get_json()
    source_path = data.get('source_path')
    items = data.get('items', [])  # List of file/folder names (may include renamed items)
    destination_path = data.get('destination_path')
    overwrite = data.get('overwrite', False)  # Whether to overwrite existing files
    
    if not source_path or not items or not destination_path:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    
    # Security check
    source_path_abs = os.path.abspath(source_path)
    destination_path_abs = os.path.abspath(destination_path)
    
    moved_items = []
    errors = []
    
    for item_name in items:
        try:
            # Get original name from source (item_name might be renamed)
            source_item_path = os.path.join(source_path, item_name)
            destination_item_path = os.path.join(destination_path, item_name)
            
            # Security check
            source_item_path = os.path.abspath(source_item_path)
            destination_item_path = os.path.abspath(destination_item_path)
            
            if not source_item_path.startswith(source_path_abs):
                errors.append(f"Access denied: {item_name}")
                continue
            
            if not os.path.exists(source_item_path):
                errors.append(f"Not found: {item_name}")
                continue
            
            # Check if destination exists
            if os.path.exists(destination_item_path) and not overwrite:
                errors.append(f"Already exists: {item_name}")
                continue
            
            # Move file or folder
            if os.path.exists(destination_item_path) and overwrite:
                if os.path.isfile(destination_item_path):
                    os.remove(destination_item_path)
                elif os.path.isdir(destination_item_path):
                    shutil.rmtree(destination_item_path)
            
            shutil.move(source_item_path, destination_item_path)
            moved_items.append(item_name)
            
        except Exception as e:
            errors.append(f"Error moving {item_name}: {str(e)}")
    
    if errors:
        return jsonify({"success": True, "moved": moved_items, "errors": errors}), 200
    else:
        return jsonify({"success": True, "moved": moved_items, "message": "All items moved successfully"}), 200

@app.route('/check_conflicts', methods=['POST'])
def check_conflicts():
    """API to check if files/folders exist in destination before paste."""
    data = request.get_json()
    destination_path = data.get('destination_path')
    items = data.get('items', [])
    
    if not destination_path or not items:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    
    conflicts = []
    for item_name in items:
        item_path = os.path.join(destination_path, item_name)
        if os.path.exists(item_path):
            conflicts.append(item_name)
    
    return jsonify({"success": True, "conflicts": conflicts}), 200
    
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

@app.route('/read_text_file', methods=['POST'])
def read_text_file():
    """API to read text file content."""
    data = request.get_json()
    system_path = data.get('system_path')
    file_name = data.get('file_name')
    
    if not system_path or not file_name:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    
    # Construct the full file path
    file_path = os.path.join(system_path, file_name)
    
    # Security check: ensure the file is inside the system_path
    file_path = os.path.abspath(file_path)
    system_path_abs = os.path.abspath(system_path)
    
    if not file_path.startswith(system_path_abs):
        return jsonify({"success": False, "error": "Access denied"}), 403
    
    try:
        # Check if file exists and is a text file
        if not os.path.exists(file_path):
            return jsonify({"success": False, "error": "File not found"}), 404
        
        # Read file content with proper encoding detection
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except UnicodeDecodeError:
            # Try with different encoding if UTF-8 fails
            try:
                with open(file_path, 'r', encoding='latin-1') as f:
                    content = f.read()
            except Exception as e:
                return jsonify({"success": False, "error": f"Unable to read file: {str(e)}"}), 500
        
        return jsonify({"success": True, "content": content})
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/save_text_file', methods=['POST'])
def save_text_file():
    """API to save text file content."""
    data = request.get_json()
    system_path = data.get('system_path')
    file_name = data.get('file_name')
    content = data.get('content')
    
    if not system_path or not file_name or content is None:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    
    # Construct the full file path
    file_path = os.path.join(system_path, file_name)
    
    # Security check: ensure the file is inside the system_path
    file_path = os.path.abspath(file_path)
    system_path_abs = os.path.abspath(system_path)
    
    if not file_path.startswith(system_path_abs):
        return jsonify({"success": False, "error": "Access denied"}), 403
    
    try:
        # Create backup of original file if it exists
        backup_path = file_path + '.backup'
        if os.path.exists(file_path):
            shutil.copy2(file_path, backup_path)
        
        # Write content to file with UTF-8 encoding
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Remove backup if save was successful
        if os.path.exists(backup_path):
            os.remove(backup_path)
        
        return jsonify({"success": True, "message": "File saved successfully"})
        
    except Exception as e:
        # Restore from backup if save failed
        if os.path.exists(backup_path):
            shutil.copy2(backup_path, file_path)
            os.remove(backup_path)
        
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/save_chat_file', methods=['POST'])
def save_chat_file():
    """API to save chat file with automatic cleanup of old files."""
    try:
        import json
        from datetime import datetime
        
        data = request.get_json()
        clientName = data.get('clientName', '')
        chatData = data.get('chatData', {})
        
        if not clientName or not chatData:
            return jsonify({'success': False, 'error': 'Missing required parameters'})
        
        # Create ChatHistory folder in the current directory
        chat_folder = os.path.join(os.getcwd(), 'ChatHistory')
        if not os.path.exists(chat_folder):
            os.makedirs(chat_folder)
        
        # Use client name as filename (one file per client)
        fileName = f"{clientName}.json"
        file_path = os.path.join(chat_folder, fileName)
        
        # Check if file exists and load existing data
        existing_data = {}
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    existing_data = json.load(f)
            except:
                existing_data = {}
        
        # Merge existing messages with new messages
        existing_messages = existing_data.get('messages', [])
        new_messages = chatData.get('messages', [])
        
        # Add new messages to existing ones
        updated_messages = existing_messages + new_messages
        
        # Update the chat data
        updated_chat_data = {
            'clientName': clientName,
            'lastUpdated': datetime.now().isoformat(),
            'messages': updated_messages,
            'fileName': fileName
        }
        
        # Clean old client files if more than 10 exist
        clean_old_chat_files(chat_folder)
        
        # Save the updated chat file
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(updated_chat_data, f, indent=2, ensure_ascii=False)
        
        return jsonify({'success': True, 'filePath': file_path})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def clean_old_chat_files(chat_folder):
    """Clean old client chat files, keeping only the 10 most recent ones"""
    try:
        # Get all JSON files in the chat folder
        json_files = [f for f in os.listdir(chat_folder) if f.endswith('.json')]
        
        if len(json_files) > 10:
            # Sort files by modification time (oldest first)
            json_files.sort(key=lambda x: os.path.getmtime(os.path.join(chat_folder, x)))
            
            # Remove oldest client files, keeping only 10
            files_to_remove = json_files[:-10]
            
            for file_name in files_to_remove:
                file_path = os.path.join(chat_folder, file_name)
                try:
                    os.remove(file_path)
                    print(f"Removed old client chat file: {file_name}")
                except Exception as e:
                    print(f"Error removing file {file_name}: {e}")
                    
    except Exception as e:
        print(f"Error cleaning old chat files: {e}")

@app.route('/get_chat_files', methods=['GET'])
def get_chat_files():
    """Get list of available chat history files"""
    try:
        from datetime import datetime
        
        chat_folder = os.path.join(os.getcwd(), 'ChatHistory')
        
        if not os.path.exists(chat_folder):
            return jsonify({'success': True, 'files': []})
        
        json_files = [f for f in os.listdir(chat_folder) if f.endswith('.json')]
        
        # Sort files by modification time (newest first)
        json_files.sort(key=lambda x: os.path.getmtime(os.path.join(chat_folder, x)), reverse=True)
        
        return jsonify({'success': True, 'files': json_files})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/load_chat_file/<filename>', methods=['GET'])
def load_chat_file(filename):
    """Load a specific chat history file"""
    try:
        import json
        
        chat_folder = os.path.join(os.getcwd(), 'ChatHistory')
        file_path = os.path.join(chat_folder, filename)
        
        if not os.path.exists(file_path):
            return jsonify({'success': False, 'error': 'File not found'})
        
        with open(file_path, 'r', encoding='utf-8') as f:
            chat_data = json.load(f)
        
        return jsonify({'success': True, 'chatData': chat_data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/load_global_chat', methods=['GET'])
def load_global_chat():
    """Load global chat history for multi-client chat"""
    try:
        import json
        
        chat_folder = os.path.join(os.getcwd(), 'ChatHistory')
        global_chat_file = os.path.join(chat_folder, 'global_chat.json')
        
        if not os.path.exists(global_chat_file):
            return jsonify({'success': True, 'chatData': {'messages': []}})
        
        with open(global_chat_file, 'r', encoding='utf-8') as f:
            chat_data = json.load(f)
        
        return jsonify({'success': True, 'chatData': chat_data})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_folder_contents', methods=['POST'])
def get_folder_contents():
    """API to get list of all files and folders in a specified path (including subdirectories)"""
    try:
        data = request.get_json()
        folder_path = data.get('folder_path', '')
        
        if not folder_path:
            return jsonify({'success': False, 'error': 'Missing folder_path parameter'}), 400
        
        # Security check: ensure the path exists and is accessible
        if not os.path.exists(folder_path):
            return jsonify({'success': False, 'error': 'Path does not exist'}), 404
        
        if not os.path.isdir(folder_path):
            return jsonify({'success': False, 'error': 'Path is not a directory'}), 400
        
        # Lists to store all paths
        all_folders = []
        all_files = []
        
        print(f"Starting recursive folder scan for: {folder_path}")
        
        # Walk through all subdirectories recursively - this will loop through ALL folders until no more
        for root, dirs, files in os.walk(folder_path):
            try:
                # Get relative path from the base folder_path
                relative_root = os.path.relpath(root, folder_path)
                print(f"Scanning folder: {relative_root} (contains {len(dirs)} subfolders, {len(files)} files)")
                
                # Add subdirectories (these will be scanned in the next iteration)
                for dir_name in dirs:
                    try:
                        # Create relative path for the directory
                        if relative_root == '.':
                            dir_path = dir_name
                        else:
                            dir_path = os.path.join(relative_root, dir_name)
                        all_folders.append(dir_path)
                        print(f"  Found folder: {dir_path}")
                    except (PermissionError, OSError) as e:
                        print(f"  Skipping inaccessible folder: {dir_name} - {e}")
                        continue
                
                # Add files in current folder
                for file_name in files:
                    try:
                        # Create relative path for the file
                        if relative_root == '.':
                            file_path = file_name
                        else:
                            file_path = os.path.join(relative_root, file_name)
                        all_files.append(file_path)
                        print(f"  Found file: {file_path}")
                    except (PermissionError, OSError) as e:
                        print(f"  Skipping inaccessible file: {file_name} - {e}")
                        continue
                        
            except (PermissionError, OSError) as e:
                # Skip directories that can't be accessed
                print(f"Skipping inaccessible directory: {root} - {e}")
                continue
        
        print(f"Recursive scan complete. Found {len(all_folders)} folders and {len(all_files)} files")
        
        # Sort folders and files alphabetically
        all_folders.sort()
        all_files.sort()
        
        return jsonify({
            'success': True,
            'folder_path': folder_path,
            'folders': all_folders,
            'files': all_files,
            'total_folders': len(all_folders),
            'total_files': len(all_files)
        })
        
    except Exception as e:
        print(f"Error in get_folder_contents: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/delete_chat_file/<filename>', methods=['DELETE'])
def delete_chat_file(filename):
    """Delete a specific chat file"""
    try:
        chat_folder = os.path.join(os.getcwd(), 'ChatHistory')
        file_path = os.path.join(chat_folder, filename)
        
        if os.path.exists(file_path):
            os.remove(file_path)
            return jsonify({'success': True, 'message': f'Chat file {filename} deleted successfully'})
        else:
            return jsonify({'success': False, 'error': 'Chat file not found'}), 404
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# SocketIO Event Handlers for Multi-Client Chat
@socketio.on('connect')
def handle_connect(data=None):
    """Handle client connection"""
    print(f"Client connected: {request.sid}")
    socketio.emit('user_connected', {'message': 'A new user joined the chat!'}, to=None, include_self=False)

@socketio.on('disconnect')
def handle_disconnect(data=None):
    """Handle client disconnection"""
    print(f"Client disconnected: {request.sid}")
    socketio.emit('user_disconnected', {'message': 'A user left the chat!'}, to=None, include_self=False)

@socketio.on('join_chat')
def handle_join_chat(data):
    """Handle user joining chat"""
    client_name = data.get('clientName', 'Anonymous')
    print(f"User {client_name} joined the chat")
    socketio.emit('user_joined', {
        'clientName': client_name,
        'message': f'{client_name} joined the chat!'
    }, to=None, include_self=False)

@socketio.on('send_message')
def handle_send_message(data):
    """Handle sending messages to all clients"""
    sender = data.get('sender', 'Anonymous')
    message = data.get('message', '')
    timestamp = data.get('timestamp', '')
    
    print(f"Message from {sender}: {message}")
    
    # Broadcast message to all connected clients
    socketio.emit('new_message', {
        'sender': sender,
        'message': message,
        'timestamp': timestamp,
        'type': 'other' if sender != data.get('currentClient', '') else 'own'
    }, to=None, include_self=False)
    
    # Save message to file for persistence
    try:
        import json
        from datetime import datetime
        
        chat_folder = os.path.join(os.getcwd(), 'ChatHistory')
        if not os.path.exists(chat_folder):
            os.makedirs(chat_folder)
        
        # Save to a global chat file for all users
        global_chat_file = os.path.join(chat_folder, 'global_chat.json')
        
        # Load existing messages
        existing_messages = []
        if os.path.exists(global_chat_file):
            try:
                with open(global_chat_file, 'r', encoding='utf-8') as f:
                    existing_data = json.load(f)
                    existing_messages = existing_data.get('messages', [])
            except:
                existing_messages = []
        
        # Add new message
        new_message = {
            'sender': sender,
            'message': message,
            'timestamp': timestamp,
            'type': 'other'
        }
        existing_messages.append(new_message)
        
        # Keep only last 100 messages to prevent file from growing too large
        if len(existing_messages) > 100:
            existing_messages = existing_messages[-100:]
        
        # Save updated chat data
        chat_data = {
            'lastUpdated': datetime.now().isoformat(),
            'messages': existing_messages,
            'fileName': 'global_chat.json'
        }
        
        with open(global_chat_file, 'w', encoding='utf-8') as f:
            json.dump(chat_data, f, indent=2, ensure_ascii=False)
            
    except Exception as e:
        print(f"Error saving global chat message: {e}")


if __name__ == '__main__':
    # app.run(debug=True, host="0.0.0.0", port=1298)
    #socketio.run(app, debug=True, host="0.0.0.0", port=80)
    socketio.run(app, host="0.0.0.0", port=1298, debug=True ,allow_unsafe_werkzeug=True)
# python -m flask run --host=0.0.0.0 --port=1298 --debug



from flask import Flask, jsonify, render_template

app = Flask(__name__)

# Initialize click count
click_count = 0

# Route for the main UI
@app.route('/')
def index():
    global click_count
    return render_template('index.html', click_count=click_count)

# API route to increment the count
@app.route('/increment', methods=['GET'])
def increment():
    global click_count
    click_count += 1
    return jsonify({"click_count": click_count})

if __name__ == '__main__':
    app.run(debug=True, use_reloader=False, host='0.0.0.0', port=80)

# pyinstaller --add-data "templates:index/templates" app.py
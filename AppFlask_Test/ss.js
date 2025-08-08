// Chat System Variables - Declare globally first
let currentClientName = "";
let chatHistory = [];
let isChatJoined = false;
let currentChatFile = null;
let socket = null; // SocketIO connection

// Define chat functions immediately to make them globally available
function toggleChatBox() {
    const chatContainer = document.getElementById("chatContainer");
    if (chatContainer.style.display === "flex") {
        chatContainer.style.display = "none";
    } else {
        chatContainer.style.display = "flex";
        // Initialize socket connection when opening chat
        initializeSocket();
        // Load chat history tabs when opening
        loadChatHistoryTabs();
    }
}

function initializeSocket() {
    if (!socket) {
        socket = io();

        // Handle connection
        socket.on("connect", function () {
            console.log("Connected to chat server");
        });

        // Handle disconnection
        socket.on("disconnect", function () {
            console.log("Disconnected from chat server");
        });

        // Handle new messages from other clients
        socket.on("new_message", function (data) {
            // Only add message if it's not from current user
            if (data.sender !== currentClientName) {
                addMessage(data.sender, data.message, "other", data.timestamp);
                // Add to history
                chatHistory.push({
                    sender: data.sender,
                    message: data.message,
                    timestamp: data.timestamp,
                    type: "other",
                });
            }
        });

        // Handle user joined notifications
        socket.on("user_joined", function (data) {
            if (data.clientName !== currentClientName) {
                addMessage("System", data.message, "system");
            }
        });

        // Handle user connected/disconnected notifications
        socket.on("user_connected", function (data) {
            addMessage("System", data.message, "system");
        });

        socket.on("user_disconnected", function (data) {
            addMessage("System", data.message, "system");
        });
    }
}

function uploadFiles(files = null) {
    $("#progressContainer").removeClass("d-none");
    let fileInput = document.getElementById("fileInput");
    const system_path = $("#system_path").val();

    let selectedFiles = files || fileInput.files;
    console.log(selectedFiles);
    if (selectedFiles.length === 0) {
        alert("Please select files or folders to upload!");
        return;
    }

    let formData = new FormData();
    for (let i = 0; i < selectedFiles.length; i++) {
        formData.append(
            "files",
            selectedFiles[i],
            selectedFiles[i].webkitRelativePath || selectedFiles[i].relativePath || selectedFiles[i].name
        );
    }
    formData.append("system_path", system_path);
    for (let [key, value] of formData.entries()) {
        console.log(`${key}:`, value);
    }
    let progressBar = document.getElementById("progressBar");
    let progressText = document.getElementById("progressText");
    progressBar.style.width = "0%";
    progressText.innerText = "0%";

    fetch("/upload/", {
        method: "POST",
        body: formData,
    })
        .then((response) => response.json())
        .then((data) => {
            //let uploadedFilesList = document.getElementById("uploadedFiles");
            //data.files.forEach(file => {
            //      let listItem = document.createElement("li");
            //      listItem.textContent = file;
            //      uploadedFilesList.appendChild(listItem);
            //});

            progressBar.style.width = "100%";
            progressText.innerText = "100%";
            location.reload(true);
            $("#progressContainer").addClass("d-none");
            $("#progress_zip").addClass("d-none");
        })
        .catch((error) => {
            console.error("Upload failed:", error);
            $("#progressContainer").addClass("d-none");
            $("#progress_zip").addClass("d-none");
        });
}

document.getElementById("dropZone").addEventListener("drop", function (event) {
    event.preventDefault();
    event.stopPropagation();

    let items = event.dataTransfer.items;
    let files = [];

    function readDirectory(entry, path = "") {
        if (entry.isFile) {
            entry.file((file) => {
                file.relativePath = path + file.name; // Preserve folder structure
                files.push(file);
            });
        } else if (entry.isDirectory) {
            let dirReader = entry.createReader();
            dirReader.readEntries((entries) => {
                entries.forEach((subEntry) => readDirectory(subEntry, path + entry.name + "/"));
            });
        }
    }

    for (let item of items) {
        let entry = item.webkitGetAsEntry();
        if (entry) {
            readDirectory(entry);
        }
    }

    setTimeout(() => {
        console.log("Files:", files);
        uploadFiles(files);
    }, 1000);
});

document.getElementById("dropZone").addEventListener("dragover", function (event) {
    event.preventDefault();
    event.stopPropagation();
});

// Listen for progress updates from server (commented out - socket not initialized)
// socket.on('upload_progress', function (data) {
//   let progressBar = document.getElementById('progressBar')
//   let progressText = document.getElementById('progressText')
//   progressBar.style.width = data.progress + '%'
//   progressText.innerText = data.progress + '%'
// })

$("#deleteBtn").click(function () {
    const selectedItems_ = [...selectedItems, ...selectedfile];
    let strName = "";
    for (let s of selectedItems_) {
        strName += s;
    }
    let pathToDelete = strName; // $("#pathInput").val(); // Get path from input field

    if (!pathToDelete) {
        alert("Please enter a file/folder path.");
        return;
    }
    const system_path = $("#system_path").val();

    console.log("system_path", system_path);
    console.log("Delete", selectedItems_);
    // Show confirmation popup
    if (confirm(`Are you sure you want to delete: ${pathToDelete}?`)) {
        const requestBody = {
            system_path: system_path,
            folders: selectedItems_,
        };
        fetch("/delete", {
            method: "POST",
            body: JSON.stringify(requestBody),
            headers: {
                "Content-Type": "application/json", // Specify the content type
            },
        })
            .then((response) => {
                // Check if the response status is ok (200-299)
                if (!response.ok) {
                    throw new Error(`Error: ${response.statusText}`);
                }
                return response.json(); // Parse the JSON response
            })
            .then((data) => {
                // Assuming the server returns a message in the response
                // alert(data.message);
                location.reload(true);
            })
            .catch((error) => {
                // Log any error that occurs during the request
                console.error("Error:", error);
                alert("There was an error processing your request.");
            });
    }
});

$("#NewFolder").click(function () {
    $("#popup").css("display", "flex");
});
$("#close").click(function () {
    $("#popup").css("display", "none");
});

$("#createFolderBtn").click(function () {
    let folderName = $("#folderName").val(); // Get folder name from input field
    let path = $("#system_path").val(); // Define the base path where the folder will be created

    if (!folderName) {
        alert("Please enter a folder name!");
        return;
    }

    // Send POST request to the server to create the folder
    $.ajax({
        url: "/create_folder", // Adjust the API endpoint as needed
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            system_path: path,
            folder_name: folderName,
        }),
        success: function (response) {
            //  alert(response.message);  // Show success message
            $("#popup").hide(); // Close the popup after folder creation
            $("#folderName").val("");
            location.reload(true);
            //
        },
        error: function (xhr, status, error) {
            alert("Error creating folder: " + xhr.responseJSON.error); // Show error message
        },
    });
});

// Text Editor Variables
let currentTextFilePath = "";
let currentTextFileType = "";
let codeEditor = null;

// Initialize CodeMirror editor
function initializeCodeEditor() {
    if (codeEditor) {
        codeEditor.toTextArea();
    }

    codeEditor = CodeMirror.fromTextArea(document.getElementById("textEditorTextarea"), {
        mode: "text/plain",
        theme: "monokai",
        lineNumbers: true,
        lineWrapping: false,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        autoCloseBrackets: true,
        matchBrackets: true,
        showCursorWhenSelecting: true,
        extraKeys: {
            "Ctrl-S": function (cm) {
                saveTextFile();
            },
            "Ctrl-Q": function (cm) {
                closeTextEditor();
            },
            Esc: function (cm) {
                closeTextEditor();
            },
        },
    });

    // Update status bar on cursor movement
    codeEditor.on("cursorActivity", function () {
        updateTextEditorStatus();
    });

    // Update line numbers on content change
    codeEditor.on("change", function () {
        updateLineNumbers();
    });
}

// Handle double-click on text files
function handleTextFileDoubleClick(systemPath, fileName, fileType) {
    // Check if it's a supported text file type
    const supportedTypes = [
        "txt",
        "py",
        "ini",
        "html",
        "js",
        "json",
        "config",
        "log",
        "cs",
        "sql",
        "xml",
        "bat",
        "css",
        "php",
        "java",
        "cpp",
        "c",
        "rb",
        "go",
        "rs",
        "swift",
        "kt",
        "scala",
        "ts",
        "jsx",
        "tsx",
        "vue",
        "svelte",
        "dockerfile",
        "yml",
        "yaml",
        "toml",
        "md",
        "sh",
        "ps1",
        "r",
        "m",
        "pl",
        "lua",
        "hs",
        "fs",
        "clj",
        "ex",
        "elm",
        "nim",
        "zig",
        "v",
        "cr",
        "dart",
        "coffee",
        "less",
        "sass",
        "scss",
        "styl",
        "asm",
        "s",
        "f90",
        "pas",
        "bas",
        "vbs",
        "ahk",
        "au3",
    ];
    if (!supportedTypes.includes(fileType)) {
        return; // Do nothing for non-text files
    }

    currentTextFilePath = systemPath;
    currentTextFileType = fileType;

    // Load the file content
    loadTextFile(systemPath, fileName);
}

// Load text file content
function loadTextFile(systemPath, fileName) {
    fetch("/read_text_file", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            system_path: systemPath,
            file_name: fileName,
        }),
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                document.getElementById("textEditorTitle").textContent = `Text Editor - ${fileName}`;
                // Initialize CodeMirror if not already done
                if (!codeEditor) {
                    initializeCodeEditor();
                }

                // Set content and mode
                codeEditor.setValue(data.content);
                setSyntaxHighlighting(currentTextFileType);

                document.getElementById("textEditorDialog").style.display = "flex";
                // Enforce overlay color with !important at runtime
                document
                    .getElementById("textEditorDialog")
                    .style.setProperty("background-color", "rgba(0, 0, 0, 0.8)", "important");
                document.getElementById("textEditorDialog").style.setProperty("display", "flex", "important");

                // Update status bar
                updateTextEditorStatus();
                document.getElementById("textEditorType").textContent = currentTextFileType.toUpperCase();

                // Refresh CodeMirror display
                setTimeout(() => {
                    codeEditor.refresh();
                }, 100);
            } else {
                alert("Error loading file: " + data.error);
            }
        })
        .catch((error) => {
            console.error("Error:", error);
            alert("Error loading file");
        });
}

// Save text file
function saveTextFile() {
    const content = codeEditor.getValue();
    const fileName = document.getElementById("textEditorTitle").textContent.split(" - ")[1];

    fetch("/save_text_file", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            system_path: currentTextFilePath,
            file_name: fileName,
            content: content,
        }),
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                alert("File saved successfully!");
                closeTextEditor();
            } else {
                alert("Error saving file: " + data.error);
            }
        })
        .catch((error) => {
            console.error("Error:", error);
            alert("Error saving file");
        });
}

// Close text editor
function closeTextEditor() {
    document.getElementById("textEditorDialog").style.display = "none";
    if (codeEditor) {
        codeEditor.setValue("");
    }
    document.getElementById("textEditorDialog").classList.remove("code-editor-mode");
    currentTextFilePath = "";
    currentTextFileType = "";
}

// Set syntax highlighting based on file type
function setSyntaxHighlighting(fileType) {
    let mode = "text/plain";

    switch (fileType) {
        // Python
        case "py":
            mode = "text/x-python";
            break;
        // Web Technologies
        case "html":
            mode = "text/html";
            break;
        case "js":
            mode = "text/javascript";
            break;
        case "jsx":
            mode = "text/jsx";
            break;
        case "ts":
            mode = "text/typescript";
            break;
        case "tsx":
            mode = "text/typescript-jsx";
            break;
        case "vue":
            mode = "text/x-vue";
            break;
        case "svelte":
            mode = "text/x-svelte";
            break;
        case "json":
            mode = "application/json";
            break;
        case "css":
            mode = "text/css";
            break;
        case "less":
            mode = "text/x-less";
            break;
        case "sass":
            mode = "text/x-sass";
            break;
        case "scss":
            mode = "text/x-scss";
            break;
        case "styl":
            mode = "text/x-stylus";
            break;
        // C-like Languages
        case "c":
            mode = "text/x-csrc";
            break;
        case "cpp":
            mode = "text/x-c++src";
            break;
        case "cs":
            mode = "text/x-csharp";
            break;
        case "java":
            mode = "text/x-java";
            break;
        case "kt":
            mode = "text/x-kotlin";
            break;
        case "swift":
            mode = "text/x-swift";
            break;
        case "go":
            mode = "text/x-go";
            break;
        case "rs":
            mode = "text/x-rust";
            break;
        case "scala":
            mode = "text/x-scala";
            break;
        case "dart":
            mode = "text/x-dart";
            break;
        case "zig":
            mode = "text/x-zig";
            break;
        case "v":
            mode = "text/x-v";
            break;
        case "cr":
            mode = "text/x-crystal";
            break;
        case "nim":
            mode = "text/x-nim";
            break;
        // Scripting Languages
        case "php":
            mode = "text/x-php";
            break;
        case "rb":
            mode = "text/x-ruby";
            break;
        case "pl":
            mode = "text/x-perl";
            break;
        case "lua":
            mode = "text/x-lua";
            break;
        case "coffee":
            mode = "text/x-coffeescript";
            break;
        case "r":
            mode = "text/x-r";
            break;
        case "m":
            mode = "text/x-octave";
            break;
        // Functional Languages
        case "hs":
            mode = "text/x-haskell";
            break;
        case "fs":
            mode = "text/x-fsharp";
            break;
        case "clj":
            mode = "text/x-clojure";
            break;
        case "ex":
            mode = "text/x-erlang";
            break;
        case "elm":
            mode = "text/x-elm";
            break;
        // Shell Scripts
        case "sh":
            mode = "text/x-sh";
            break;
        case "bat":
            mode = "text/x-batch";
            break;
        case "ps1":
            mode = "text/x-powershell";
            break;
        case "ahk":
            mode = "text/x-autohotkey";
            break;
        case "au3":
            mode = "text/x-autoit";
            break;
        // Configuration Files
        case "ini":
            mode = "text/x-ini";
            break;
        case "config":
            mode = "text/x-ini";
            break;
        case "yml":
        case "yaml":
            mode = "text/x-yaml";
            break;
        case "toml":
            mode = "text/x-toml";
            break;
        case "dockerfile":
            mode = "text/x-dockerfile";
            break;
        // Documentation
        case "md":
            mode = "text/x-markdown";
            break;
        // Database
        case "sql":
            mode = "text/x-sql";
            break;
        // Data Formats
        case "xml":
            mode = "text/xml";
            break;
        // Assembly
        case "asm":
        case "s":
            mode = "text/x-gas";
            break;
        // Legacy Languages
        case "f90":
            mode = "text/x-fortran";
            break;
        case "pas":
            mode = "text/x-pascal";
            break;
        case "bas":
            mode = "text/x-basic";
            break;
        case "vbs":
            mode = "text/x-vb";
            break;
        // Other
        case "log":
        case "txt":
            mode = "text/plain";
            break;
    }

    if (codeEditor) {
        codeEditor.setOption("mode", mode);
    }
}

// Update line numbers
function updateLineNumbers() {
    // CodeMirror handles line numbers automatically
}

// Update text editor status bar
function updateTextEditorStatus() {
    if (!codeEditor) return;

    const status = document.getElementById("textEditorInfo");

    function updateStatus() {
        const cursor = codeEditor.getCursor();
        const line = cursor.line + 1;
        const column = cursor.ch + 1;

        status.textContent = `Line ${line}, Column ${column}`;
    }

    // Initial update
    updateStatus();
}

// Chat functions are now defined at the top of the script

// Load chat history tabs from server
function loadChatHistoryTabs() {
    fetch("/get_chat_files")
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                const tabList = document.getElementById("chatTabList");
                // Keep the "New Chat" tab
                const newChatTab = tabList.querySelector(".tab-item");
                tabList.innerHTML = "";
                tabList.appendChild(newChatTab);

                // Add Global Chat tab
                const globalChatTab = document.createElement("div");
                globalChatTab.className = "tab-item";
                globalChatTab.onclick = () => loadGlobalChat();
                globalChatTab.innerHTML = `
                 <i class="fa-solid fa-globe"></i>
                 <span>Global Chat</span>
               `;
                tabList.appendChild(globalChatTab);

                // Add individual chat history tabs
                data.files.forEach((file) => {
                    // Skip global chat file as it's handled separately
                    if (file === "global_chat.json") return;

                    const fileName = file.replace(".json", "");
                    const tabItem = document.createElement("div");
                    tabItem.className = "tab-item";
                    tabItem.onclick = () => loadChatHistory(fileName);
                    tabItem.innerHTML = `
                   <i class="fa-solid fa-comments"></i>
                   <span>${fileName}</span>
                 `;
                    tabList.appendChild(tabItem);
                });
            }
        })
        .catch((error) => {
            console.error("Error loading chat tabs:", error);
        });
}

// Switch to new chat
function switchToNewChat() {
    // Update active tab
    document.querySelectorAll(".tab-item").forEach((tab) => tab.classList.remove("active"));
    event.target.closest(".tab-item").classList.add("active");

    // Reset chat state
    currentClientName = "";
    isChatJoined = false;
    currentChatFile = null;
    chatHistory = [];

    // Clear messages
    document.getElementById("chatMessages").innerHTML = `
             <div class="chat-welcome">
               <h3>💬 Multi-Client Chat</h3>
               <p>Welcome to the chat system!</p>
               <p>Enter your name below to start chatting.</p>
               <p>You can also join the "Global Chat" to chat with all users.</p>
             </div>
           `;

    // Show name input, hide chat input
    document.getElementById("clientNameInput").classList.remove("d-none");
    document.getElementById("chatInputContainer").classList.add("d-none");
}

// Join chat with client name
function joinChat() {
    const clientName = document.getElementById("clientName").value.trim();
    if (!clientName) {
        alert("Please enter your name!");
        return;
    }

    currentClientName = clientName;
    isChatJoined = true;

    // Initialize socket if not already done
    initializeSocket();

    // Emit join event for global chat
    if (socket) {
        socket.emit("join_chat", { clientName: clientName });
    }

    // Hide name input, show chat input
    document.getElementById("clientNameInput").classList.add("d-none");
    document.getElementById("chatInputContainer").classList.remove("d-none");

    // Load existing chat history for this client
    loadClientChatHistory();

    // Create/update chat folder and save initial data
    createChatFolder();

    // Refresh tab list to include new chat
    loadChatHistoryTabs();

    // Update chat title
    document.getElementById("chatTitle").textContent = `💬 Chat - ${clientName}`;
}

// Load existing chat history
function loadChatHistory(name) {
    // Update active tab
    document.querySelectorAll(".tab-item").forEach((tab) => tab.classList.remove("active"));
    event.target.closest(".tab-item").classList.add("active");

    currentClientName = name;
    isChatJoined = true;
    currentChatFile = `${name}.json`;

    // Initialize socket if not already done
    initializeSocket();

    if (socket) {
        socket.emit("join_chat", { clientName: name });
    }

    // Hide name input, show chat input
    document.getElementById("clientNameInput").classList.add("d-none");
    document.getElementById("chatInputContainer").classList.remove("d-none");

    // Load chat history from server
    fetch(`/load_chat_file/${name}.json`)
        .then((response) => response.json())
        .then((data) => {
            if (data.success && data.chatData) {
                // Clear current messages
                document.getElementById("chatMessages").innerHTML = "";

                // Load existing messages
                const existingMessages = data.chatData.messages || [];
                chatHistory = existingMessages;

                // Display existing messages
                existingMessages.forEach((msg) => {
                    addMessage(msg.sender, msg.message, msg.type || "other", msg.timestamp);
                });

                console.log("Loaded chat history for:", name);
            }
        })
        .catch((error) => {
            console.error("Error loading chat history:", error);
            // Show error message
            document.getElementById("chatMessages").innerHTML = `
               <div class="chat-welcome">
                 <p>Error loading chat history. Please try again.</p>
               </div>
             `;
        });

    // Update chat title
    document.getElementById("chatTitle").textContent = `💬 Chat - ${name}`;
}

// Load global chat
function loadGlobalChat() {
    // Update active tab
    document.querySelectorAll(".tab-item").forEach((tab) => tab.classList.remove("active"));
    event.target.closest(".tab-item").classList.add("active");

    // Set current client to global mode
    currentClientName = "Global";
    isChatJoined = true;
    currentChatFile = "global_chat.json";

    // Initialize socket if not already done
    initializeSocket();

    // Hide name input, show chat input
    document.getElementById("clientNameInput").classList.add("d-none");
    document.getElementById("chatInputContainer").classList.remove("d-none");

    // Load global chat history
    fetch("/load_global_chat")
        .then((response) => response.json())
        .then((data) => {
            if (data.success && data.chatData) {
                // Clear current messages
                document.getElementById("chatMessages").innerHTML = "";

                // Load existing messages
                const existingMessages = data.chatData.messages || [];
                chatHistory = existingMessages;

                // Display existing messages
                existingMessages.forEach((msg) => {
                    addMessage(msg.sender, msg.message, msg.type || "other", msg.timestamp);
                });

                console.log("Loaded global chat history");
            }
        })
        .catch((error) => {
            console.error("Error loading global chat history:", error);
            // Show error message
            document.getElementById("chatMessages").innerHTML = `
               <div class="chat-welcome">
                 <p>Error loading global chat history. Please try again.</p>
               </div>
             `;
        });

    // Update chat title
    document.getElementById("chatTitle").textContent = "💬 Global Chat";
}

// Send message
function sendMessage() {
    const messageInput = document.getElementById("chatInput");
    const message = messageInput.value.trim();

    if (!message || !isChatJoined) return;

    const now = new Date();
    const timestamp = now.toISOString();

    // Add message to UI
    addMessage(currentClientName, message, "own", timestamp);

    // Clear input
    messageInput.value = "";

    // Send message to all clients via SocketIO for global chat
    if (socket) {
        socket.emit("send_message", {
            sender: currentClientName,
            message: message,
            timestamp: timestamp,
            currentClient: currentClientName,
        });
    }

    // Save message to individual client file if not in global chat
    if (currentChatFile !== "global_chat.json") {
        saveChatMessage(currentClientName, message);
    }
}

// Add message to chat display
function addMessage(sender, message, type, timestamp) {
    const chatMessages = document.getElementById("chatMessages");
    const messageDiv = document.createElement("div");
    messageDiv.className = `chat-message ${type}`;

    const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

    messageDiv.innerHTML = `
             <div class="message-header">
               <span class="sender">${sender}</span>
               <span class="time">${time}</span>
             </div>
             <div class="message-content">${message}</div>
           `;

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Save individual message to chat file
function saveChatMessage(sender, message) {
    const now = new Date();

    // Update chat history
    chatHistory.push({
        sender: sender,
        message: message,
        timestamp: now.toISOString(),
        type: "own",
    });

    const chatData = {
        clientName: currentClientName,
        startTime: new Date().toISOString(),
        messages: chatHistory,
    };

    // Save updated data (one file per client)
    fetch("/save_chat_file", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            clientName: currentClientName,
            chatData: chatData,
        }),
    })
        .then((response) => response.json())
        .then((data) => {
            if (!data.success) {
                console.error("Error saving message:", data.error);
            } else {
                // Refresh tab list to update timestamps
                loadChatHistoryTabs();
            }
        })
        .catch((error) => {
            console.error("Error saving message:", error);
        });
}

// Create chat folder and save initial data
function createChatFolder() {
    const now = new Date();

    const chatData = {
        clientName: currentClientName,
        startTime: now.toISOString(),
        messages: chatHistory,
    };

    // Save to server (one file per client)
    fetch("/save_chat_file", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            clientName: currentClientName,
            chatData: chatData,
        }),
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                console.log("Client chat file created/updated successfully");
            } else {
                console.error("Error creating chat file:", data.error);
            }
        })
        .catch((error) => {
            console.error("Error saving chat file:", error);
        });
}

// Load existing chat history for client
function loadClientChatHistory() {
    fetch(`/load_chat_file/${currentClientName}.json`)
        .then((response) => response.json())
        .then((data) => {
            if (data.success && data.chatData) {
                // Load existing messages
                const existingMessages = data.chatData.messages || [];
                chatHistory = existingMessages;

                // Display existing messages with their original timestamps
                existingMessages.forEach((msg) => {
                    addMessage(msg.sender, msg.message, msg.type || "own", msg.timestamp);
                });

                console.log("Loaded existing chat history for:", currentClientName);
            }
        })
        .catch((error) => {
            console.log("No existing chat history found for:", currentClientName);
        });
}

// Handle Enter key in chat input
document.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        if (document.getElementById("chatInput").matches(":focus")) {
            sendMessage();
        } else if (document.getElementById("clientName").matches(":focus")) {
            joinChat();
        }
    }
});

// Make functions globally available immediately
window.toggleChatBox = toggleChatBox;
window.joinChat = joinChat;
window.sendMessage = sendMessage;
window.switchToNewChat = switchToNewChat;
window.loadChatHistory = loadChatHistory;
window.loadGlobalChat = loadGlobalChat;

// Load chat history tabs from server
function loadChatHistoryTabs() {
    fetch("/get_chat_files")
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                const tabList = document.getElementById("chatTabList");
                // Keep the "New Chat" tab
                const newChatTab = tabList.querySelector(".tab-item");
                tabList.innerHTML = "";
                tabList.appendChild(newChatTab);

                // Add Global Chat tab
                const globalChatTab = document.createElement("div");
                globalChatTab.className = "tab-item";
                globalChatTab.onclick = () => loadGlobalChat();
                globalChatTab.innerHTML = `
                 <i class="fa-solid fa-globe"></i>
                 <span>Global Chat</span>
               `;
                tabList.appendChild(globalChatTab);

                // Add individual chat history tabs
                data.files.forEach((file) => {
                    const clientName = file.name.replace(".json", "");
                    // Skip global chat file
                    if (clientName !== "global_chat") {
                        const tabItem = document.createElement("div");
                        tabItem.className = "tab-item";
                        tabItem.onclick = () => loadChatHistory(clientName);
                        tabItem.innerHTML = `
                     <i class="fa-solid fa-comments"></i>
                     <span>${clientName}</span>
                   `;
                        tabList.appendChild(tabItem);
                    }
                });
            }
        })
        .catch((error) => {
            console.error("Error loading chat history tabs:", error);
        });
}

// Load global chat
function loadGlobalChat() {
    // Update active tab
    document.querySelectorAll(".tab-item").forEach((tab) => tab.classList.remove("active"));
    event.target.closest(".tab-item").classList.add("active");

    // Set current client to global mode
    currentClientName = "Global";
    isChatJoined = true;
    currentChatFile = "global_chat.json";

    // Initialize socket if not already done
    initializeSocket();

    // Hide name input, show chat input
    document.getElementById("clientNameInput").classList.add("d-none");
    document.getElementById("chatInputContainer").classList.remove("d-none");

    // Load global chat history
    fetch("/load_global_chat")
        .then((response) => response.json())
        .then((data) => {
            if (data.success && data.chatData) {
                // Clear current messages
                document.getElementById("chatMessages").innerHTML = "";

                // Load existing messages
                const existingMessages = data.chatData.messages || [];
                chatHistory = existingMessages;

                // Display existing messages
                existingMessages.forEach((msg) => {
                    addMessage(msg.sender, msg.message, msg.type || "other", msg.timestamp);
                });

                console.log("Loaded global chat history");
            }
        })
        .catch((error) => {
            console.error("Error loading global chat history:", error);
            // Show error message
            document.getElementById("chatMessages").innerHTML = `
               <div class="chat-welcome">
                 <p>Error loading global chat history. Please try again.</p>
               </div>
             `;
        });
}

// Switch to new chat
function switchToNewChat() {
    // Reset chat state
    currentClientName = "";
    isChatJoined = false;
    chatHistory = [];
    currentChatFile = null;

    // Update active tab
    document.querySelectorAll(".tab-item").forEach((tab) => tab.classList.remove("active"));
    document.querySelector(".tab-item").classList.add("active");

    // Reset chat UI
    document.getElementById("chatMessages").innerHTML = `
             <div class="chat-welcome">
               <p>Welcome to the multi-client chat! Enter your name to start chatting.</p>
               <p>💬 Join the Global Chat to chat with all users in real-time!</p>
             </div>
           `;
    document.getElementById("clientNameInput").classList.remove("d-none");
    document.getElementById("chatInputContainer").classList.add("d-none");
    document.getElementById("clientName").value = "";
    document.getElementById("chatInput").value = "";
}

// Load specific chat history
function loadChatHistory(clientName) {
    // Update active tab
    document.querySelectorAll(".tab-item").forEach((tab) => tab.classList.remove("active"));
    event.target.closest(".tab-item").classList.add("active");

    // Set current client
    currentClientName = clientName;
    isChatJoined = true;
    currentChatFile = `${clientName}.json`;

    // Initialize socket if not already done
    initializeSocket();

    // Emit join event to server
    if (socket) {
        socket.emit("join_chat", { clientName: clientName });
    }

    // Hide name input, show chat input
    document.getElementById("clientNameInput").classList.add("d-none");
    document.getElementById("chatInputContainer").classList.remove("d-none");

    // Load chat history
    fetch(`/load_chat_file/${clientName}.json`)
        .then((response) => response.json())
        .then((data) => {
            if (data.success && data.chatData) {
                // Clear current messages
                document.getElementById("chatMessages").innerHTML = "";

                // Load existing messages
                const existingMessages = data.chatData.messages || [];
                chatHistory = existingMessages;

                // Display existing messages
                existingMessages.forEach((msg) => {
                    addMessage(msg.sender, msg.message, msg.type || "own", msg.timestamp);
                });

                console.log("Loaded chat history for:", clientName);
            }
        })
        .catch((error) => {
            console.error("Error loading chat history:", error);
            // Show error message
            document.getElementById("chatMessages").innerHTML = `
               <div class="chat-welcome">
                 <p>Error loading chat history. Please try again.</p>
               </div>
             `;
        });
}

// Join chat with client name
function joinChat() {
    const clientNameInput = document.getElementById("clientName");
    const name = clientNameInput.value.trim();

    if (name.length < 2) {
        alert("Please enter a valid name (at least 2 characters)");
        return;
    }

    currentClientName = name;
    isChatJoined = true;

    // Initialize socket if not already done
    initializeSocket();

    // Emit join event to server
    if (socket) {
        socket.emit("join_chat", { clientName: name });
    }

    // Hide name input, show chat input
    document.getElementById("clientNameInput").classList.add("d-none");
    document.getElementById("chatInputContainer").classList.remove("d-none");

    // Clear welcome message and add join message
    document.getElementById("chatMessages").innerHTML = "";
    addMessage("System", `${name} joined the chat!`, "system");

    // Load existing chat history for this client
    loadClientChatHistory();

    // Create/update chat folder and save initial data
    createChatFolder();

    // Refresh tab list to include new chat
    loadChatHistoryTabs();

    // Focus on chat input
    document.getElementById("chatInput").focus();
}

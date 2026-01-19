let selectedItems = [];
let selectedfile = [];
let wail_select = false;

let list_down_load = [];
function CreateListDownLoad_Path(){
    list_down_load = [];
    const system_path = $("#system_path").val();
    
    // Call API to get folder contents
    fetch("/get_folder_contents", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ folder_path: system_path }),
    })
    .then((response) => response.json())
    .then((data) => {
        if (data.success) {
            console.log("Folder contents:", data);
            
            // Add folders to list_down_load
            data.folders.forEach(folderName => {
                list_down_load.push({system_path, folderName, type: 'folder'});
            });
            
            // Add files to list_down_load
            data.files.forEach(fileName => {
                list_down_load.push({system_path, folderName: fileName, type: 'file'});
            });
            
            console.log("Updated list_down_load:", list_down_load);
            console.log(`Total items: ${data.total_folders} folders, ${data.total_files} files`);
        } else {
            console.error("Error getting folder contents:", data.error);
        }
    })
    .catch((error) => {
        console.error("Error calling API:", error);
    });
}
function handleClickSelect(e, systemPath, folderName, i = 0) {
    console.log("ssssssss")
    let $element = $(e); // Convert to jQuery object
    if (wail_select) {
        // Add checkmark when wail_select is true
        // Toggle folder selection
        const itemIndex = selectedItems.indexOf(folderName);
        const itemfileIndex = selectedfile.indexOf(folderName);
        if (itemIndex === -1 && itemfileIndex === -1) {
            if (i == 1) {
                selectedfile.push(folderName); // Add to selection
            } else {
                selectedItems.push(folderName); // Add to selection
            }
            if (!$element.find(".select-icon").length) {
                $element.find(".item").append('<div class="select-icon"></div>');
                $element.find(".item").addClass("is_select");
            }
        } else {
            if (i == 1) {
                selectedfile.splice(itemfileIndex, 1); // Remove from selection
            } else {
                selectedItems.splice(itemIndex, 1); // Remove from selection
            }

            $element.find(".select-icon").remove();
            $element.find(".item").removeClass("is_select");
        }

        console.log("Selected folders:", selectedItems);
        console.log("Selected file:", selectedfile);
        
        // Update Select All button text
        if (typeof updateSelectAllButtonText === 'function') {
            updateSelectAllButtonText();
        }
        
        // Show/hide OpenFile button based on selection
        // Show Open button when exactly one file OR one folder is selected
        if ((selectedfile.length === 1 && selectedItems.length === 0) || 
            (selectedItems.length === 1 && selectedfile.length === 0)) {
            $("#OpenFile").removeClass("d-none");
        } else {
            $("#OpenFile").addClass("d-none");
        }
    }
}

function handleDoubleClick(systemPath, folderName) {
    // Handle double-click (e.g., navigate to folder)
    // Normalize path separator for Windows/Linux compatibility
    const separator = systemPath.includes('\\') ? '\\' : '/';
    const fullPath = systemPath + (systemPath.endsWith('/') || systemPath.endsWith('\\') ? '' : separator) + folderName;
    window.location.href = "/?path=" + encodeURIComponent(fullPath);
}
function selectdive(e) {
    const parent = $(e).closest('.menu_left');
    parent.find('.i-menu').removeClass('active');
    $(e).addClass('active');
const selectedPath = $(e).text().trim();
console.log(selectedPath)
    window.location.href = "/?path=" + encodeURIComponent(selectedPath);
}
function downloadSelectedFiles() {
    const len = selectedItems.length;
    const lenfile = selectedfile.length;
    if (len === 0 && lenfile === 0) {
        alert("No folders selected!");
        return;
    }

    const system_path = $("#system_path").val();
    if (lenfile === 1 && len === 0) {
        download_one(selectedfile[0]);
    } else {
        $("#progress_zip").removeClass("d-none");

        const selectedItems_ = [...selectedItems, ...selectedfile];

        // Send selected folders to the server to create a ZIP file
        fetch("/download_folders", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ system_path: system_path, folders: selectedItems_ }),
        })
            .then((response) => response.json()) // Server returns a zip file
            .then((data) => {
                if (data.zip_file) {
                    const system_path = encodeURIComponent($("#system_path").val()); // Encode path to prevent issues
                    window.location.href = `/download/${data.zip_file}?path=${system_path}`;
                } else {
                    alert("Error: " + data.error);
                }
                $("#progress_zip").addClass("d-none");
            })

            .catch((error) => {
                $("#progress_zip").addClass("d-none");
                console.error("Error downloading folders:", error);
            });
    }
}

function download_one(file_name) {
    const system_path = encodeURIComponent($("#system_path").val()); // Encode path to prevent issues
    window.location.href = `/download/${file_name}?path=${system_path}`;
}

function changePath() {
    let selectedPath = document.getElementById("driveSelect").value;
    window.location.href = "/?path=" + encodeURIComponent(selectedPath);
}

$(document).ready(function () {
    let timer; // Timer for long press
    let holdTime = 500; // Time threshold in milliseconds

    $(".folder-link").on("mousedown touchstart", function (e) {
        let $this = $(this);
        // timer = setTimeout(function () {
            console.log("Hold");
            $("#selectDownload").removeClass("d-none");
            $("#copyBtn").removeClass("d-none");
            $("#cutBtn").removeClass("d-none");
            $("#renameBtn").removeClass("d-none");
            $("#deleteBtn").removeClass("d-none");
            
            // Show Open button when exactly one file OR one folder is selected
            if ((selectedfile.length === 1 && selectedItems.length === 0) || 
                (selectedItems.length === 1 && selectedfile.length === 0)) {
                $("#OpenFile").removeClass("d-none");
            } else {
                $("#OpenFile").addClass("d-none");
            }

            // Add a selection indicator when long pressed
            if (!$this.find(".select-icon").length) {
                $(".item").addClass("wait_select");
                $this.find(".item").addClass("is_select");
                $this.find(".item").append('<div class="select-icon"></div>');
                wail_select = true;
            }
        // }, holdTime);
    });

    $(".folder-link").on("mouseup mouseleave touchend", function () {
        clearTimeout(timer); // Cancel if user releases before holdTime
    });

    // Remove icon when clicking anywhere else (but not on popups)
    $(document).on("click", function (e) {
        // Don't clear selection if we just ended a drag operation
        if ($(document).data('endingDrag')) {
            return;
        }
        
        // Don't clear selection if clicking on popup elements
        if ($(e.target).closest(".popup").length || 
            $(e.target).closest("#renamePopup").length ||
            $(e.target).closest("#popup").length ||
            $(e.target).closest("#pasteConflictDialog").length) {
            return;
        }
        
        // Don't clear selection if clicking on tabMenu, dropdown toggle, or dropdown menu
        if ($(e.target).closest("#tabMenu").length ||
            $(e.target).closest(".dropdown-toggle").length ||
            $(e.target).closest(".dropdown-menu").length ||
            $(e.target).closest(".dropdown").length) {
            return;
        }
        
        if (!$(e.target).closest(".folder-link").length) {
            $(".select-icon").remove();
            $(".item").removeClass("wait_select");
            $(".item").removeClass("is_select");
            wail_select = false;
            $("#selectDownload").addClass("d-none");
            $("#copyBtn").addClass("d-none");
            $("#cutBtn").addClass("d-none");
            $("#renameBtn").addClass("d-none");
            $("#deleteBtn").addClass("d-none");
            $("#OpenFile").addClass("d-none");
            // Don't hide paste button - it should stay visible if clipboard has data

            selectedItems = [];
            selectedfile = [];
        }
    });
});
var host = window.location.hostname; // Get current domain/IP
var port = "1298"; // Set your WebSocket port
var socket = io.connect("http://" + host + ":" + port);

// var socket = io.connect("http://10.88.88.132:1298");

socket.on("zip_progress", function (data) {
    document.getElementById("progress_text").innerText = "Progress: " + data.progress + "%";
    document.getElementById("progress_bar").value = data.progress;
});

let selectedItems = [];
let selectedfile = [];
let wail_select = false;

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
                $element.find(".item").append('<i class="fa-solid fa-check select-icon"></i>');
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
    }
}

function handleDoubleClick(systemPath, folderName) {
    // Handle double-click (e.g., navigate to folder)
    window.location.href = "/?path=" + systemPath + "/" + folderName;
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
            $("#deleteBtn").removeClass("d-none");

            // Add a checkmark icon when long pressed
            if (!$this.find(".select-icon").length) {
                $(".item").addClass("wait_select");
                $this.find(".item").addClass("is_select");
                $this.find(".item").append('<i class="fa-solid fa-check select-icon"></i>');
                wail_select = true;
            }
        // }, holdTime);
    });

    $(".folder-link").on("mouseup mouseleave touchend", function () {
        clearTimeout(timer); // Cancel if user releases before holdTime
    });

    // Remove icon when clicking anywhere else
    $(document).on("click", function (e) {
        if (!$(e.target).closest(".folder-link").length) {
            $(".select-icon").remove();
            $(".item").removeClass("wait_select");
            $(".item").removeClass("is_select");
            wail_select = false;
            $("#selectDownload").addClass("d-none");
            $("#deleteBtn").addClass("d-none");

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

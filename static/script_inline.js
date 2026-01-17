function uploadFiles(files = null) {
  $('#progressContainer').removeClass('d-none')
  let fileInput = document.getElementById('fileInput')
  const system_path = $('#system_path').val()

  let selectedFiles = files || fileInput.files
  console.log(selectedFiles)
  if (selectedFiles.length === 0) {
    alert('Please select files or folders to upload!')
    return
  }

  let formData = new FormData()
  for (let i = 0; i < selectedFiles.length; i++) {
    formData.append('files', selectedFiles[i], selectedFiles[i].webkitRelativePath || selectedFiles[i].relativePath || selectedFiles[i].name)
  }
  formData.append('system_path', system_path)
  for (let [key, value] of formData.entries()) {
    console.log(`${key}:`, value)
  }
  let progressBar = document.getElementById('progressBar')
  let progressText = document.getElementById('progressText')
  progressBar.style.width = '0%'
  progressText.innerText = '0%'

  fetch('/upload/', {
    method: 'POST',
    body: formData
  })
    .then((response) => response.json())
    .then((data) => {
      //let uploadedFilesList = document.getElementById("uploadedFiles");
      //data.files.forEach(file => {
      //      let listItem = document.createElement("li");
      //      listItem.textContent = file;
      //      uploadedFilesList.appendChild(listItem);
      //});

      progressBar.style.width = '100%'
      progressText.innerText = '100%'
      location.reload(true)
      $('#progressContainer').addClass('d-none')
      $('#progress_zip').addClass('d-none')
    })
    .catch((error) => {
      console.error('Upload failed:', error)
      $('#progressContainer').addClass('d-none')
      $('#progress_zip').addClass('d-none')
    })
}

document.getElementById('dropZone').addEventListener('drop', function (event) {
  event.preventDefault()
  event.stopPropagation()

  let items = event.dataTransfer.items
  let files = []

  function readDirectory(entry, path = '') {
    if (entry.isFile) {
      entry.file((file) => {
        file.relativePath = path + file.name // Preserve folder structure
        files.push(file)
      })
    } else if (entry.isDirectory) {
      let dirReader = entry.createReader()
      dirReader.readEntries((entries) => {
        entries.forEach((subEntry) => readDirectory(subEntry, path + entry.name + '/'))
      })
    }
  }

  for (let item of items) {
    let entry = item.webkitGetAsEntry()
    if (entry) {
      readDirectory(entry)
    }
  }

  setTimeout(() => {
    console.log('Files:', files)
    uploadFiles(files)
  }, 1000)
})

document.getElementById('dropZone').addEventListener('dragover', function (event) {
  event.preventDefault()
  event.stopPropagation()
})

// Listen for progress updates from server (commented out - socket not initialized)
// socket.on('upload_progress', function (data) {
//   let progressBar = document.getElementById('progressBar')
//   let progressText = document.getElementById('progressText')
//   progressBar.style.width = data.progress + '%'
//   progressText.innerText = data.progress + '%'
// })

$('#deleteBtn').on('click', function (e) {
  e.preventDefault()
  e.stopPropagation()
  
  const selectedItems_ = [...selectedItems, ...selectedfile]
  let strName = ''
  for (let s of selectedItems_) {
    strName += s
  }
  let pathToDelete = strName // $("#pathInput").val(); // Get path from input field

  if (!pathToDelete) {
    alert('Please enter a file/folder path.')
    return
  }
  
  // Close dropdown
  const dropdownElement = $(this).closest('.dropdown-menu').siblings('.dropdown-toggle')[0]
  if (dropdownElement) {
    const dropdown = bootstrap.Dropdown.getInstance(dropdownElement)
    if (dropdown) dropdown.hide()
  }
  
  const system_path = $('#system_path').val()

  console.log('system_path', system_path)
  console.log('Delete', selectedItems_)
  // Show confirmation popup
  if (confirm(`Are you sure you want to delete: ${pathToDelete}?`)) {
    const requestBody = {
      system_path: system_path,
      folders: selectedItems_
    }
    fetch('/delete', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: {
        'Content-Type': 'application/json' // Specify the content type
      }
    })
      .then((response) => {
        // Check if the response status is ok (200-299)
        if (!response.ok) {
          throw new Error(`Error: ${response.statusText}`)
        }
        return response.json() // Parse the JSON response
      })
      .then((data) => {
        // Assuming the server returns a message in the response
        // alert(data.message);
        location.reload(true)
      })
      .catch((error) => {
        // Log any error that occurs during the request
        console.error('Error:', error)
        alert('There was an error processing your request.')
      })
  }
})

$('#NewFolder').click(function () {
  $('#popup').css('display', 'flex')
})

$('#NewFile').click(function () {
  $('#newFilePopup').css('display', 'flex')
  $('#newFileName').val('')
  $('#newFileExtension').val('txt')
  $('#newFileError').hide()
  $('#newFileErrorText').text('')
  $('#newFileName').focus()
})

$('#SelectAll').click(function () {
  selectAllItems()
})

$('#closeNewFile').click(function () {
  $('#newFilePopup').css('display', 'none')
  $('#newFileName').val('')
  $('#newFileError').hide()
  $('#newFileErrorText').text('')
})

$('#createFileBtn').click(function () {
  let fileName = $('#newFileName').val().trim()
  let fileExtension = $('#newFileExtension').val()
  let path = $('#system_path').val()
  
  // Hide previous errors
  $('#newFileError').hide()
  $('#newFileErrorText').text('')
  
  if (!fileName) {
    $('#newFileErrorText').text('Please enter a file name!')
    $('#newFileError').show()
    return
  }
  
  // Construct full file name with extension
  const fullFileName = fileName + '.' + fileExtension
  
  // Send POST request to create the file
  $.ajax({
    url: '/create_file',
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({
      system_path: path,
      file_name: fullFileName
    }),
    success: function (response) {
      $('#newFilePopup').hide()
      $('#newFileName').val('')
      $('#newFileError').hide()
      $('#newFileErrorText').text('')
      location.reload(true)
    },
    error: function (xhr, status, error) {
      // Show error in popup
      let errorMessage = 'Unknown error occurred'
      if (xhr.responseJSON && xhr.responseJSON.error) {
        errorMessage = xhr.responseJSON.error
      } else if (xhr.responseText) {
        try {
          const errorData = JSON.parse(xhr.responseText)
          errorMessage = errorData.error || errorData.message || xhr.responseText
        } catch (e) {
          errorMessage = xhr.responseText || error
        }
      } else {
        errorMessage = error || status
      }
      
      $('#newFileErrorText').text(errorMessage)
      $('#newFileError').show()
      
      // Scroll to error
      $('#newFileError')[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })
})

$('#OpenFile').click(function () {
  // Get selected files or folders
  const hasFile = selectedfile.length > 0
  const hasFolder = selectedItems.length > 0
  
  // Check if exactly one item is selected (either file or folder)
  if ((hasFile ? 1 : 0) + (hasFolder ? 1 : 0) !== 1) {
    if (selectedfile.length === 0 && selectedItems.length === 0) {
      alert('Please select a file or folder to open!')
    } else if (selectedfile.length > 1 || selectedItems.length > 1 || (selectedfile.length > 0 && selectedItems.length > 0)) {
      alert('Please select only one file or folder to open!')
    }
    return
  }
  
  const systemPath = $('#system_path').val()
  
  // If folder is selected, navigate to it
  if (hasFolder && selectedItems.length === 1) {
    const folderName = selectedItems[0]
    // Use handleDoubleClick to navigate to folder
    if (typeof handleDoubleClick === 'function') {
      handleDoubleClick(systemPath, folderName)
    } else {
      // Fallback: navigate manually
      const separator = systemPath.includes('\\') ? '\\' : '/'
      const fullPath = systemPath + (systemPath.endsWith('/') || systemPath.endsWith('\\') ? '' : separator) + folderName
      window.location.href = '/?path=' + encodeURIComponent(fullPath)
    }
    return
  }
  
  // If file is selected, open it based on type
  const fileName = selectedfile[0]
  
  // Get file extension
  const fileExtension = fileName.split('.').pop().toLowerCase()
  
  // Open file based on type
  if (fileExtension === 'jpg' || fileExtension === 'jpeg' || fileExtension === 'png' || fileExtension === 'gif' || fileExtension === 'bmp' || fileExtension === 'webp') {
    // Open image in dialog using openDialog function
    const imageUrl = `./getimage/${encodeURIComponent(fileName)}?path=${encodeURIComponent(systemPath)}`
    if (typeof openDialog === 'function') {
      openDialog(imageUrl)
    } else {
      // Fallback if openDialog is not available
      document.getElementById('dialog-image').src = imageUrl
      document.getElementById('dialog-contentz').style.display = 'flex'
    }
  } else if (fileExtension === 'mp4' || fileExtension === 'webm' || fileExtension === 'ogg' || fileExtension === 'avi' || fileExtension === 'mov' || fileExtension === 'mkv' || fileExtension === 'flv' || fileExtension === 'wmv') {
    // Open video in video player
    openVideoPlayer(systemPath, fileName)
  } else {
    // For text files, use handleTextFileDoubleClick
    handleTextFileDoubleClick(systemPath, fileName, fileExtension)
  }
})

// Video player state
let videoList = []
let currentVideoIndex = 0
let currentSystemPath = ''

// Function to open video player
function openVideoPlayer(systemPath, fileName) {
  currentSystemPath = systemPath
  
  // Get all video files in current directory
  const allItems = document.querySelectorAll('.item_video, .item')
  videoList = []
  
  allItems.forEach(item => {
    const link = item.closest('.folder-link')
    if (link) {
      const txt = item.querySelector('.txt')
      if (txt) {
        const itemName = txt.textContent.trim()
        const fileExt = itemName.split('.').pop().toLowerCase()
        const videoExtensions = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'mkv', 'flv', 'wmv']
        if (videoExtensions.includes(fileExt)) {
          videoList.push(itemName)
        }
      }
    }
  })
  
  // Find current video index
  currentVideoIndex = videoList.indexOf(fileName)
  if (currentVideoIndex === -1) {
    currentVideoIndex = 0
  }
  
  // Load and play video
  loadVideo(currentVideoIndex)
  
  // Show video player dialog
  const dialog = document.getElementById('videoPlayerDialog')
  dialog.style.display = 'flex'
  
  // Update video info
  updateVideoInfo()
}

// Function to load video
function loadVideo(index) {
  if (index < 0 || index >= videoList.length) return
  
  currentVideoIndex = index
  const videoPlayer = document.getElementById('videoPlayer')
  const videoUrl = `./download/${encodeURIComponent(videoList[index])}?path=${encodeURIComponent(currentSystemPath)}`
  
  videoPlayer.src = videoUrl
  videoPlayer.load()
  
  // Update title
  const title = document.getElementById('videoPlayerTitle')
  title.textContent = videoList[index]
  
  // Update video info
  updateVideoInfo()
  
  // Update button states
  updateVideoButtons()
}

// Function to update video info
function updateVideoInfo() {
  document.getElementById('currentVideoIndex').textContent = currentVideoIndex + 1
  document.getElementById('totalVideos').textContent = videoList.length
}

// Function to update video navigation buttons
function updateVideoButtons() {
  const prevBtn = document.getElementById('prevVideoBtn')
  const nextBtn = document.getElementById('nextVideoBtn')
  
  prevBtn.disabled = currentVideoIndex === 0
  nextBtn.disabled = currentVideoIndex === videoList.length - 1
  
  if (prevBtn.disabled) {
    prevBtn.style.opacity = '0.5'
    prevBtn.style.cursor = 'not-allowed'
  } else {
    prevBtn.style.opacity = '1'
    prevBtn.style.cursor = 'pointer'
  }
  
  if (nextBtn.disabled) {
    nextBtn.style.opacity = '0.5'
    nextBtn.style.cursor = 'not-allowed'
  } else {
    nextBtn.style.opacity = '1'
    nextBtn.style.cursor = 'pointer'
  }
}

// Close video player
function closeVideoPlayer() {
  const dialog = document.getElementById('videoPlayerDialog')
  const videoPlayer = document.getElementById('videoPlayer')
  
  videoPlayer.pause()
  videoPlayer.src = ''
  dialog.style.display = 'none'
  dialog.classList.remove('fullscreen')
  
  // Exit fullscreen if active
  if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen()
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen()
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen()
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen()
    }
  }
}

// Toggle fullscreen
function toggleFullscreen() {
  const dialog = document.getElementById('videoPlayerDialog')
  const videoPlayer = document.getElementById('videoPlayer')
  const fullscreenBtn = document.getElementById('fullscreenBtn')
  
  if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.mozFullScreenElement && !document.msFullscreenElement) {
    // Enter fullscreen
    if (dialog.requestFullscreen) {
      dialog.requestFullscreen()
    } else if (dialog.webkitRequestFullscreen) {
      dialog.webkitRequestFullscreen()
    } else if (dialog.mozRequestFullScreen) {
      dialog.mozRequestFullScreen()
    } else if (dialog.msRequestFullscreen) {
      dialog.msRequestFullscreen()
    }
    
    dialog.classList.add('fullscreen')
    fullscreenBtn.innerHTML = '<i class="fa-solid fa-compress"></i>'
  } else {
    // Exit fullscreen
    if (document.exitFullscreen) {
      document.exitFullscreen()
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen()
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen()
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen()
    }
    
    dialog.classList.remove('fullscreen')
    fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>'
  }
}

// Video player event handlers
$(document).ready(function() {
  // Close button
  $('#closeVideoPlayer').click(function() {
    closeVideoPlayer()
  })
  
  // Previous video button
  $('#prevVideoBtn').click(function() {
    if (currentVideoIndex > 0) {
      loadVideo(currentVideoIndex - 1)
    }
  })
  
  // Next video button
  $('#nextVideoBtn').click(function() {
    if (currentVideoIndex < videoList.length - 1) {
      loadVideo(currentVideoIndex + 1)
    }
  })
  
  // Fullscreen button
  $('#fullscreenBtn').click(function() {
    toggleFullscreen()
  })
  
  // Keyboard shortcuts
  $(document).keydown(function(e) {
    const dialog = document.getElementById('videoPlayerDialog')
    if (dialog.style.display === 'flex') {
      // Escape to close
      if (e.key === 'Escape') {
        closeVideoPlayer()
      }
      // Arrow left for previous
      else if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
        if (currentVideoIndex > 0) {
          loadVideo(currentVideoIndex - 1)
        }
      }
      // Arrow right for next
      else if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
        if (currentVideoIndex < videoList.length - 1) {
          loadVideo(currentVideoIndex + 1)
        }
      }
      // F for fullscreen
      else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      }
    }
  })
  
  // Handle fullscreen change events
  document.addEventListener('fullscreenchange', function() {
    const dialog = document.getElementById('videoPlayerDialog')
    const fullscreenBtn = document.getElementById('fullscreenBtn')
    if (!document.fullscreenElement) {
      dialog.classList.remove('fullscreen')
      fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>'
    }
  })
  
  document.addEventListener('webkitfullscreenchange', function() {
    const dialog = document.getElementById('videoPlayerDialog')
    const fullscreenBtn = document.getElementById('fullscreenBtn')
    if (!document.webkitFullscreenElement) {
      dialog.classList.remove('fullscreen')
      fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>'
    }
  })
  
  document.addEventListener('mozfullscreenchange', function() {
    const dialog = document.getElementById('videoPlayerDialog')
    const fullscreenBtn = document.getElementById('fullscreenBtn')
    if (!document.mozFullScreenElement) {
      dialog.classList.remove('fullscreen')
      fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>'
    }
  })
  
  document.addEventListener('MSFullscreenChange', function() {
    const dialog = document.getElementById('videoPlayerDialog')
    const fullscreenBtn = document.getElementById('fullscreenBtn')
    if (!document.msFullscreenElement) {
      dialog.classList.remove('fullscreen')
      fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>'
    }
  })
})
$('#close').click(function () {
  $('#popup').css('display', 'none')
})

$('#createFolderBtn').click(function () {
  let folderName = $('#folderName').val() // Get folder name from input field
  let path = $('#system_path').val() // Define the base path where the folder will be created

  if (!folderName) {
    alert('Please enter a folder name!')
    return
  }

  // Send POST request to the server to create the folder
  $.ajax({
    url: '/create_folder', // Adjust the API endpoint as needed
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({
      system_path: path,
      folder_name: folderName
    }),
    success: function (response) {
      //  alert(response.message);  // Show success message
      $('#popup').hide() // Close the popup after folder creation
      $('#folderName').val('')
      location.reload(true)
      //
    },
    error: function (xhr, status, error) {
      alert('Error creating folder: ' + xhr.responseJSON.error) // Show error message
    }
  })
})

// Rename functionality
$('#renameBtn').on('click', function (e) {
  e.preventDefault()
  e.stopPropagation(); // Prevent event bubbling
  
  const selectedItems_ = [...selectedItems, ...selectedfile]
  
  if (selectedItems_.length === 0) {
    alert('Please select a file or folder to rename!')
    return
  }
  
  if (selectedItems_.length > 1) {
    alert('Please select only one file or folder to rename!')
    return
  }
  
  const oldName = selectedItems_[0]
  
  // Store selection before opening popup to prevent clearing
  localStorage.setItem('renameSelection', JSON.stringify({
    oldName: oldName,
    isFile: selectedfile.includes(oldName),
    isFolder: selectedItems.includes(oldName)
  }))
  
  // Close dropdown
  const dropdownElement = $(this).closest('.dropdown-menu').siblings('.dropdown-toggle')[0]
  if (dropdownElement) {
    const dropdown = bootstrap.Dropdown.getInstance(dropdownElement)
    if (dropdown) dropdown.hide()
  }
  
  $('#renameName').val(oldName)
  $('#renamePopup').css('display', 'flex')
  
  // Prevent popup click from clearing selection
  $('#renamePopup').on('click', function(e) {
    e.stopPropagation();
  })
})

$('#closeRename').click(function (e) {
  e.stopPropagation(); // Prevent event bubbling
  $('#renamePopup').css('display', 'none')
  $('#renameName').val('')
  // Clear stored selection when closing without renaming
  localStorage.removeItem('renameSelection')
})

$('#renameConfirmBtn').click(function (e) {
  e.stopPropagation(); // Prevent event bubbling
  
  // Try to get selection from arrays first, then from localStorage
  let selectedItems_ = [...selectedItems, ...selectedfile]
  let oldName = null
  let isFile = false
  let isFolder = false
  
  if (selectedItems_.length > 0) {
    oldName = selectedItems_[0]
    isFile = selectedfile.includes(oldName)
    isFolder = selectedItems.includes(oldName)
  } else {
    // Fallback to localStorage if selection was cleared
    const storedSelection = localStorage.getItem('renameSelection')
    if (storedSelection) {
      try {
        const data = JSON.parse(storedSelection)
        oldName = data.oldName
        isFile = data.isFile
        isFolder = data.isFolder
      } catch (e) {
        console.error('Error parsing stored selection:', e)
      }
    }
  }
  
  if (!oldName) {
    alert('Please select a file or folder to rename!')
    return
  }
  
  const newName = $('#renameName').val()
  const system_path = $('#system_path').val()
  
  if (!newName || newName.trim() === '') {
    alert('Please enter a new name!')
    return
  }
  
  if (newName === oldName) {
    alert('New name must be different from the current name!')
    return
  }
  
  // Send POST request to rename
  $.ajax({
    url: '/rename',
    method: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({
      system_path: system_path,
      old_name: oldName,
      new_name: newName.trim()
    }),
    success: function (response) {
      if (response.success) {
        // Store selection info in localStorage for restore after reload
        localStorage.setItem('restoreSelection', JSON.stringify({
          newName: newName.trim(),
          isFile: isFile,
          isFolder: isFolder,
          systemPath: system_path
        }))
        
        // Clear rename selection storage
        localStorage.removeItem('renameSelection')
        
        $('#renamePopup').hide()
        $('#renameName').val('')
        location.reload(true)
      } else {
        alert('Error renaming: ' + response.error)
      }
    },
    error: function (xhr, status, error) {
      const errorMsg = xhr.responseJSON ? xhr.responseJSON.error : 'Unknown error'
      alert('Error renaming: ' + errorMsg)
    }
  })
})

// Allow Enter key to submit rename
$('#renameName').keypress(function (e) {
  if (e.which === 13) { // Enter key
    $('#renameConfirmBtn').click()
  }
})

// Copy, Cut, Paste functionality
let clipboardData = {
  items: [],
  sourcePath: '',
  operation: '' // 'copy' or 'cut'
}

// Load clipboard data from localStorage on page load
function loadClipboardData() {
  const savedClipboard = localStorage.getItem('clipboardData');
  if (savedClipboard) {
    try {
      const data = JSON.parse(savedClipboard);
      if (data.items && data.items.length > 0 && data.operation) {
        clipboardData.items = data.items;
        clipboardData.sourcePath = data.sourcePath;
        clipboardData.operation = data.operation;
        return true;
      }
    } catch (e) {
      console.error('Error loading clipboard data:', e);
    }
  }
  return false;
}

// Save clipboard data to localStorage
function saveClipboardData() {
  if (clipboardData.items && clipboardData.items.length > 0 && clipboardData.operation) {
    localStorage.setItem('clipboardData', JSON.stringify(clipboardData));
  } else {
    localStorage.removeItem('clipboardData');
  }
}

// Load clipboard on script load
loadClipboardData();

// Copy button
$('#copyBtn').on('click', function (e) {
  e.preventDefault()
  e.stopPropagation()
  const selectedItems_ = [...selectedItems, ...selectedfile]
  
  if (selectedItems_.length === 0) {
    alert('Please select files or folders to copy!')
    return
  }
  
  clipboardData.items = selectedItems_
  clipboardData.sourcePath = $('#system_path').val()
  clipboardData.operation = 'copy'
  
  // Save to localStorage
  saveClipboardData()
  
  // Show status
  $('#copyStatusText').text(`Copy: ${selectedItems_.length} item(s)`)
  $('#copyStatus').removeClass('d-none')
  
  // Show paste button in dropdown (it's always visible if clipboard has data)
  $('#pasteBtn').removeClass('d-none')
  
  // Close dropdown
  const dropdownElement = $(this).closest('.dropdown-menu').siblings('.dropdown-toggle')[0]
  if (dropdownElement) {
    const dropdown = bootstrap.Dropdown.getInstance(dropdownElement)
    if (dropdown) dropdown.hide()
  }
})

// Cut button
$('#cutBtn').on('click', function (e) {
  e.preventDefault()
  e.stopPropagation()
  const selectedItems_ = [...selectedItems, ...selectedfile]
  
  if (selectedItems_.length === 0) {
    alert('Please select files or folders to cut!')
    return
  }
  
  clipboardData.items = selectedItems_
  clipboardData.sourcePath = $('#system_path').val()
  clipboardData.operation = 'cut'
  
  // Save to localStorage
  saveClipboardData()
  
  // Show status
  $('#copyStatusText').text(`Cut: ${selectedItems_.length} item(s)`)
  $('#copyStatus').removeClass('d-none')
  
  // Show paste button in dropdown
  $('#pasteBtn').removeClass('d-none')
  
  // Close dropdown
  const dropdownElement = $(this).closest('.dropdown-menu').siblings('.dropdown-toggle')[0]
  if (dropdownElement) {
    const dropdown = bootstrap.Dropdown.getInstance(dropdownElement)
    if (dropdown) dropdown.hide()
  }
})

// Paste button
$('#pasteBtn').on('click', function (e) {
  e.preventDefault()
  e.stopPropagation()
  
  if (clipboardData.items.length === 0) {
    alert('No items to paste!')
    return
  }
  
  const destinationPath = $('#system_path').val()
  
  // Close dropdown
  const dropdownElement = $(this).closest('.dropdown-menu').siblings('.dropdown-toggle')[0]
  if (dropdownElement) {
    const dropdown = bootstrap.Dropdown.getInstance(dropdownElement)
    if (dropdown) dropdown.hide()
  }
  
  // Check for all conflicts first
  fetch('/check_conflicts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      destination_path: destinationPath,
      items: clipboardData.items
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && data.conflicts.length > 0) {
        // Process conflicts one by one
        processConflicts(destinationPath, clipboardData.items, data.conflicts, 0)
      } else {
        // No conflicts, execute paste directly
        executePaste(destinationPath, clipboardData.items)
      }
    })
    .catch(error => {
      console.error('Error checking conflicts:', error)
      alert('Error checking for conflicts')
    })
})

// Process conflicts one by one
function processConflicts(destinationPath, items, conflicts, conflictIndex) {
  if (conflictIndex >= conflicts.length) {
    // All conflicts processed, execute paste
    executePaste(destinationPath, items)
    return
  }
  
  const conflictItem = conflicts[conflictIndex]
  const itemIndex = items.indexOf(conflictItem)
  
  if (itemIndex === -1) {
    // Item not found, skip
    processConflicts(destinationPath, items, conflicts, conflictIndex + 1)
    return
  }
  
  // Show conflict dialog
  showConflictDialog(conflictItem, destinationPath, items, itemIndex, conflicts, conflictIndex)
}

// Show conflict dialog
let currentConflictIndex = 0
let currentConflictItemIndex = 0
let currentConflictItems = []
let currentConflictDestination = ''
let currentAllConflicts = []
let currentConflictConflictIndex = 0

function showConflictDialog(itemName, destinationPath, items, itemIndex, allConflicts, conflictIndex) {
  currentConflictIndex = itemIndex
  currentConflictItemIndex = itemIndex
  currentConflictItems = items
  currentConflictDestination = destinationPath
  currentAllConflicts = allConflicts
  currentConflictConflictIndex = conflictIndex
  
  $('#conflictFileName').text(`"${itemName}" already exists. What would you like to do?`)
  $('#pasteConflictDialog').css('display', 'flex')
}

// Conflict dialog handlers
$('#closePasteConflict').click(function () {
  $('#pasteConflictDialog').hide()
  // Cancel all remaining items
  currentConflictItems = []
  currentAllConflicts = []
})

$('#pasteCancelBtn').click(function () {
  $('#pasteConflictDialog').hide()
  currentConflictItems = []
  currentAllConflicts = []
})

$('#pasteOverwriteBtn').click(function () {
  $('#pasteConflictDialog').hide()
  // Mark item for overwrite
  const conflictItem = currentConflictItems[currentConflictItemIndex]
  if (!pasteOverwriteItems.includes(conflictItem)) {
    pasteOverwriteItems.push(conflictItem)
  }
  // Continue with overwrite (item will be overwritten)
  // Move to next conflict
  processConflicts(currentConflictDestination, currentConflictItems, currentAllConflicts, currentConflictConflictIndex + 1)
})

$('#pasteCopyNameBtn').click(function () {
  $('#pasteConflictDialog').hide()
  // Rename item with "Copy" suffix
  const itemName = currentConflictItems[currentConflictItemIndex]
  const baseName = itemName
  let newName = baseName
  let counter = 1
  
  // Store mapping for rename
  const originalName = clipboardData.items.find(item => item === itemName) || itemName
  if (!pasteItemsMap[originalName]) {
    pasteItemsMap[originalName] = itemName
  }
  
  // Find unique name
  function findUniqueName() {
    fetch('/check_conflicts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        destination_path: currentConflictDestination,
        items: [newName]
      })
    })
      .then(response => response.json())
      .then(data => {
        if (data.success && data.conflicts.length > 0) {
          // Name still exists, try next
          counter++
          const nameParts = baseName.split('.')
          if (nameParts.length > 1) {
            const ext = nameParts.pop()
            newName = nameParts.join('.') + ' Copy(' + counter + ').' + ext
          } else {
            newName = baseName + ' Copy(' + counter + ')'
          }
          findUniqueName()
        } else {
          // Found unique name, update item name and continue
          currentConflictItems[currentConflictItemIndex] = newName
          pasteItemsMap[originalName] = newName
          // Move to next conflict
          processConflicts(currentConflictDestination, currentConflictItems, currentAllConflicts, currentConflictConflictIndex + 1)
        }
      })
      .catch(error => {
        console.error('Error finding unique name:', error)
        // Continue anyway
        processConflicts(currentConflictDestination, currentConflictItems, currentAllConflicts, currentConflictConflictIndex + 1)
      })
  }
  
  // Start finding unique name
  const nameParts = baseName.split('.')
  if (nameParts.length > 1) {
    const ext = nameParts.pop()
    newName = nameParts.join('.') + ' Copy.' + ext
  } else {
    newName = baseName + ' Copy'
  }
  findUniqueName()
})

$('#pasteSkipBtn').click(function () {
  $('#pasteConflictDialog').hide()
  // Remove item from list and continue
  currentConflictItems.splice(currentConflictItemIndex, 1)
  // Also remove from conflicts list if it exists
  const conflictItem = currentAllConflicts[currentConflictConflictIndex]
  const conflictIndex = currentAllConflicts.indexOf(conflictItem)
  if (conflictIndex !== -1) {
    currentAllConflicts.splice(conflictIndex, 1)
  }
  // Continue with next conflict (same index since we removed one)
  processConflicts(currentConflictDestination, currentConflictItems, currentAllConflicts, currentConflictConflictIndex)
})

// Execute paste operation
let pasteOverwriteItems = []
let pasteItemsMap = {} // Map original names to destination names

function executePaste(destinationPath, items) {
  if (items.length === 0) {
    alert('No items to paste!')
    return
  }
  
  const url = clipboardData.operation === 'copy' ? '/copy' : '/move'
  const originalItems = clipboardData.items
  
  // Build request data: use original names from source, but rename in destination if needed
  const itemsToPaste = []
  const overwriteItems = []
  
  items.forEach((itemName, index) => {
    // Find original name
    const originalName = originalItems[index] || itemName
    
    // Check if this item should be overwritten
    if (pasteOverwriteItems.includes(itemName)) {
      overwriteItems.push({
        sourceName: originalName,
        destName: itemName
      })
    } else {
      itemsToPaste.push({
        sourceName: originalName,
        destName: itemName
      })
    }
  })
  
  // Function to paste items with renaming
  function pasteItemsWithRename(itemsList, shouldOverwrite) {
    return new Promise((resolve, reject) => {
      if (itemsList.length === 0) {
        resolve({ success: true, pasted: [] })
        return
      }
      
      // First, copy/move with original names to temp, then rename
      const sourceNames = itemsList.map(item => item.sourceName)
      const destNames = itemsList.map(item => item.destName)
      
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source_path: clipboardData.sourcePath,
          destination_path: destinationPath,
          items: sourceNames,
          overwrite: shouldOverwrite
        })
      })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            // Rename items if needed
            const renamePromises = []
            itemsList.forEach((item, idx) => {
              if (item.sourceName !== item.destName) {
                renamePromises.push(
                  fetch('/rename', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      system_path: destinationPath,
                      old_name: item.sourceName,
                      new_name: item.destName
                    })
                  })
                )
              }
            })
            
            if (renamePromises.length > 0) {
              Promise.all(renamePromises)
                .then(responses => Promise.all(responses.map(r => r.json())))
                .then(results => {
                  resolve(data)
                })
                .catch(reject)
            } else {
              resolve(data)
            }
          } else {
            resolve(data)
          }
        })
        .catch(reject)
    })
  }
  
  // Paste all items
  Promise.all([
    pasteItemsWithRename(itemsToPaste, false),
    pasteItemsWithRename(overwriteItems, true)
  ])
    .then(results => {
      // Check for errors
      const allErrors = []
      results.forEach(result => {
        if (result.errors) {
          allErrors.push(...result.errors)
        }
      })
      
      if (allErrors.length > 0 && allErrors.length === items.length) {
        alert('Error pasting: ' + allErrors.join(', '))
        return
      }
      
      // Clear clipboard if cut operation
      if (clipboardData.operation === 'cut') {
        clipboardData.items = []
        clipboardData.operation = ''
        clipboardData.sourcePath = ''
        saveClipboardData() // Clear from localStorage
        $('#copyStatus').hide()
        $('#pasteBtn').addClass('d-none')
      } else {
        // Keep clipboard for copy operation (can paste multiple times)
        // Just clear conflict data
        pasteOverwriteItems = []
        pasteItemsMap = {}
        saveClipboardData() // Keep in localStorage
      }
      
      // Reload page
      location.reload(true)
    })
    .catch(error => {
      console.error('Error:', error)
      alert('Error pasting items')
    })
}

// Text Editor Variables
let currentTextFilePath = '';
let currentTextFileType = '';
let codeEditor = null;

// Initialize CodeMirror editor
function initializeCodeEditor() {
  if (codeEditor) {
    codeEditor.toTextArea();
  }

  codeEditor = CodeMirror.fromTextArea(document.getElementById('textEditorTextarea'), {
    mode: 'text/plain',
    theme: 'monokai',
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
      "Esc": function (cm) {
        closeTextEditor();
      }
    }
  });

  // Update status bar on cursor movement
  codeEditor.on('cursorActivity', function () {
    updateTextEditorStatus();
  });

  // Update line numbers on content change
  codeEditor.on('change', function () {
    updateLineNumbers();
  });
}

// Handle double-click on text files
function handleTextFileDoubleClick(systemPath, fileName, fileType) {
  // Check if it's a supported text file type
  const supportedTypes = ['txt', 'py', 'ini', 'html', 'js', 'json', 'config', 'log', 'cs', 'sql', 'xml', 'bat', 'service', 'css', 'php', 'java', 'cpp', 'c', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'ts', 'jsx', 'tsx', 'vue', 'svelte', 'dockerfile', 'yml', 'yaml', 'toml', 'md', 'sh', 'ps1', 'r', 'm', 'pl', 'lua', 'hs', 'fs', 'clj', 'ex', 'elm', 'nim', 'zig', 'v', 'cr', 'dart', 'coffee', 'less', 'sass', 'scss', 'styl', 'asm', 's', 'f90', 'pas', 'bas', 'vbs', 'ahk', 'au3'];
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
  fetch('/read_text_file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      system_path: systemPath,
      file_name: fileName
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        document.getElementById('textEditorTitle').textContent = `Text Editor - ${fileName}`;
        // Initialize CodeMirror if not already done
        if (!codeEditor) {
          initializeCodeEditor();
        }

        // Set content and mode
        codeEditor.setValue(data.content);
        setSyntaxHighlighting(currentTextFileType);

        document.getElementById('textEditorDialog').style.display = 'flex';
        // Enforce overlay color with !important at runtime
        document.getElementById('textEditorDialog')
          .style.setProperty('background-color', 'rgba(0, 0, 0, 0.8)', 'important');
        document.getElementById('textEditorDialog')
          .style.setProperty('display', 'flex', 'important');

        // Update status bar
        updateTextEditorStatus();
        document.getElementById('textEditorType').textContent = currentTextFileType.toUpperCase();

        // Refresh CodeMirror display
        setTimeout(() => {
          codeEditor.refresh();
        }, 100);
      } else {
        alert('Error loading file: ' + data.error);
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Error loading file');
    });
}

// Save text file
function saveTextFile() {
  const content = codeEditor.getValue();
  const fileName = document.getElementById('textEditorTitle').textContent.split(' - ')[1];

  fetch('/save_text_file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      system_path: currentTextFilePath,
      file_name: fileName,
      content: content
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        alert('File saved successfully!');
        closeTextEditor();
      } else {
        alert('Error saving file: ' + data.error);
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Error saving file');
    });
}

// Close text editor
function closeTextEditor() {
  document.getElementById('textEditorDialog').style.display = 'none';
  if (codeEditor) {
    codeEditor.setValue('');
  }
  document.getElementById('textEditorDialog').classList.remove('code-editor-mode');
  currentTextFilePath = '';
  currentTextFileType = '';
}

// Set syntax highlighting based on file type
function setSyntaxHighlighting(fileType) {
  let mode = 'text/plain';

  switch (fileType) {
    // Python
    case 'py':
      mode = 'text/x-python';
      break;
    // Web Technologies
    case 'html':
      mode = 'text/html';
      break;
    case 'js':
      mode = 'text/javascript';
      break;
    case 'jsx':
      mode = 'text/jsx';
      break;
    case 'ts':
      mode = 'text/typescript';
      break;
    case 'tsx':
      mode = 'text/typescript-jsx';
      break;
    case 'vue':
      mode = 'text/x-vue';
      break;
    case 'svelte':
      mode = 'text/x-svelte';
      break;
    case 'json':
      mode = 'application/json';
      break;
    case 'css':
      mode = 'text/css';
      break;
    case 'less':
      mode = 'text/x-less';
      break;
    case 'sass':
      mode = 'text/x-sass';
      break;
    case 'scss':
      mode = 'text/x-scss';
      break;
    case 'styl':
      mode = 'text/x-stylus';
      break;
    // C-like Languages
    case 'c':
      mode = 'text/x-csrc';
      break;
    case 'cpp':
      mode = 'text/x-c++src';
      break;
    case 'cs':
      mode = 'text/x-csharp';
      break;
    case 'java':
      mode = 'text/x-java';
      break;
    case 'kt':
      mode = 'text/x-kotlin';
      break;
    case 'swift':
      mode = 'text/x-swift';
      break;
    case 'go':
      mode = 'text/x-go';
      break;
    case 'rs':
      mode = 'text/x-rust';
      break;
    case 'scala':
      mode = 'text/x-scala';
      break;
    case 'dart':
      mode = 'text/x-dart';
      break;
    case 'zig':
      mode = 'text/x-zig';
      break;
    case 'v':
      mode = 'text/x-v';
      break;
    case 'cr':
      mode = 'text/x-crystal';
      break;
    case 'nim':
      mode = 'text/x-nim';
      break;
    // Scripting Languages
    case 'php':
      mode = 'text/x-php';
      break;
    case 'rb':
      mode = 'text/x-ruby';
      break;
    case 'pl':
      mode = 'text/x-perl';
      break;
    case 'lua':
      mode = 'text/x-lua';
      break;
    case 'coffee':
      mode = 'text/x-coffeescript';
      break;
    case 'r':
      mode = 'text/x-r';
      break;
    case 'm':
      mode = 'text/x-octave';
      break;
    // Functional Languages
    case 'hs':
      mode = 'text/x-haskell';
      break;
    case 'fs':
      mode = 'text/x-fsharp';
      break;
    case 'clj':
      mode = 'text/x-clojure';
      break;
    case 'ex':
      mode = 'text/x-erlang';
      break;
    case 'elm':
      mode = 'text/x-elm';
      break;
    // Shell Scripts
    case 'sh':
      mode = 'text/x-sh';
      break;
    case 'bat':
      mode = 'text/x-batch';
      break;
    case 'service':
      mode = 'text/x-ini'; // systemd service files are ini-like
      break;
    case 'ps1':
      mode = 'text/x-powershell';
      break;
    case 'ahk':
      mode = 'text/x-autohotkey';
      break;
    case 'au3':
      mode = 'text/x-autoit';
      break;
    // Configuration Files
    case 'ini':
      mode = 'text/x-ini';
      break;
    case 'config':
      mode = 'text/x-ini';
      break;
    case 'yml':
    case 'yaml':
      mode = 'text/x-yaml';
      break;
    case 'toml':
      mode = 'text/x-toml';
      break;
    case 'dockerfile':
      mode = 'text/x-dockerfile';
      break;
    // Documentation
    case 'md':
      mode = 'text/x-markdown';
      break;
    // Database
    case 'sql':
      mode = 'text/x-sql';
      break;
    // Data Formats
    case 'xml':
      mode = 'text/xml';
      break;
    // Assembly
    case 'asm':
    case 's':
      mode = 'text/x-gas';
      break;
    // Legacy Languages
    case 'f90':
      mode = 'text/x-fortran';
      break;
    case 'pas':
      mode = 'text/x-pascal';
      break;
    case 'bas':
      mode = 'text/x-basic';
      break;
    case 'vbs':
      mode = 'text/x-vb';
      break;
    // Other
    case 'log':
    case 'txt':
      mode = 'text/plain';
      break;
  }

  if (codeEditor) {
    codeEditor.setOption('mode', mode);
  }
}

// Update line numbers
function updateLineNumbers() {
  // CodeMirror handles line numbers automatically
}

// Update text editor status bar
function updateTextEditorStatus() {
  if (!codeEditor) return;

  const status = document.getElementById('textEditorInfo');

  function updateStatus() {
    const cursor = codeEditor.getCursor();
    const line = cursor.line + 1;
    const column = cursor.ch + 1;

    status.textContent = `Line ${line}, Column ${column}`;
  }

  // Initial update
  updateStatus();
}

// View Mode Management
let currentViewMode = 'grid'; // 'grid', 'list-multi', 'list-vertical'

// Initialize view mode on page load
// Function to create breadcrumb navigation from path
function createBreadcrumbNavigator(path) {
  const breadcrumbNav = document.getElementById('breadcrumbNav');
  if (!breadcrumbNav) return;
  
  // Clear existing breadcrumb
  breadcrumbNav.innerHTML = '<input type="text" class="d-none" id="system_path" value="' + (path || '') + '" />';
  
  if (!path) return;
  
  // Detect path separator and normalize
  const isWindowsPath = path.includes('\\') || path.includes('://');
  const separator = isWindowsPath ? (path.includes('\\') ? '\\' : '/') : '/';
  const normalizedPath = path.replace(/\\/g, '/');
  
  // Split path into parts
  let pathParts = [];
  let basePath = '';
  
  if (normalizedPath.includes('://')) {
    // Handle Windows paths like "H://CutVideo/folder" or "H:\CutVideo\folder"
    const parts = normalizedPath.split('://');
    if (parts.length === 2) {
      basePath = parts[0] + '://';
      pathParts.push(parts[0] + '://');
      if (parts[1]) {
        const subParts = parts[1].split('/').filter(p => p);
        pathParts = pathParts.concat(subParts);
      }
    }
  } else if (normalizedPath.startsWith('/')) {
    // Handle Linux absolute paths
    basePath = '/';
    pathParts.push('/');
    const subParts = normalizedPath.split('/').filter(p => p);
    pathParts = pathParts.concat(subParts);
  } else {
    // Handle relative paths
    pathParts = normalizedPath.split('/').filter(p => p);
  }
  
  // Build breadcrumb HTML
  // Preserve the original path format for navigation
  const originalPathFormat = path;
  let currentPath = '';
  
  pathParts.forEach((part, index) => {
    const breadcrumbItem = document.createElement('span');
    breadcrumbItem.className = 'breadcrumb-item';
    
    // Build path up to this point - preserve original format
    if (index === 0) {
      if (part.endsWith('://')) {
        // Windows drive like "H://"
        currentPath = part;
      } else if (part === '/') {
        // Linux root
        currentPath = '/';
      } else {
        currentPath = part;
      }
    } else {
      if (currentPath.endsWith('://')) {
        // Windows: "H://" + "folder" = "H://folder" (no separator needed after ://)
        currentPath = currentPath + part;
      } else if (currentPath === '/') {
        // Linux: "/" + "home" = "/home"
        currentPath = '/' + part;
      } else {
        // Add separator based on original path format
        if (originalPathFormat.includes('://')) {
          // Windows path with :// format - always use /
          // Ensure we don't add double slashes
          if (!currentPath.endsWith('/')) {
            currentPath = currentPath + '/' + part;
          } else {
            currentPath = currentPath + part;
          }
        } else if (originalPathFormat.includes('\\')) {
          // Windows path with backslash
          if (!currentPath.endsWith('\\')) {
            currentPath = currentPath + '\\' + part;
          } else {
            currentPath = currentPath + part;
          }
        } else {
          // Linux path
          if (!currentPath.endsWith('/')) {
            currentPath = currentPath + '/' + part;
          } else {
            currentPath = currentPath + part;
          }
        }
      }
    }
    
    // Check if this is the last item (current directory)
    const isLast = index === pathParts.length - 1;
    
    // Store currentPath for this breadcrumb item
    const breadcrumbPath = currentPath;
    
    if (isLast) {
      // Last item - not clickable, just display
      breadcrumbItem.className += ' active';
      // Display part name (not the full path)
      const displayName = part.endsWith('://') ? part.replace('://', ':') : part;
      breadcrumbItem.textContent = displayName;
    } else {
      // Clickable breadcrumb item
      const link = document.createElement('a');
      link.href = '#';
      // Display part name (not the full path)
      const displayName = part.endsWith('://') ? part.replace('://', ':') : part;
      link.textContent = displayName;
      link.title = breadcrumbPath;
      
      // Use closure to capture the correct path
      (function(navPath) {
        link.onclick = function(e) {
          e.preventDefault();
          // Navigate to this path - use the exact format from original path
          let finalPath = navPath;
          
          // Ensure path format matches original
          // If original uses :// format, ensure navigation path uses it too
          if (originalPathFormat.includes('://')) {
            // Ensure we maintain :// format
            if (!finalPath.includes('://') && finalPath.match(/^[A-Za-z]:/)) {
              finalPath = finalPath.replace(/^([A-Za-z]):/, '$1://');
            }
          }
          
          // Encode and navigate
          const encodedPath = encodeURIComponent(finalPath);
          window.location.href = '/?path=' + encodedPath;
        };
      })(breadcrumbPath);
      
      breadcrumbItem.appendChild(link);
    }
    
    // Add separator (except for last item)
    if (!isLast) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-separator';
      // Use separator based on original path format
      if (originalPathFormat.includes('://')) {
        sep.textContent = '/';
      } else if (originalPathFormat.includes('\\')) {
        sep.textContent = '\\';
      } else {
        sep.textContent = '/';
      }
      breadcrumbItem.appendChild(sep);
    }
    
    breadcrumbNav.appendChild(breadcrumbItem);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Create breadcrumb navigator from current path
  const systemPath = document.getElementById('system_path');
  if (systemPath && systemPath.value) {
    createBreadcrumbNavigator(systemPath.value);
  }
  
  // Add click handlers for view mode buttons
  const menuItems = document.querySelectorAll('.item_menu[data-view]');
  menuItems.forEach(item => {
    item.addEventListener('click', function() {
      const viewMode = this.getAttribute('data-view');
      setViewMode(viewMode);
    });
  });
  
  // Download confirm dialog handlers
  const closeDownloadConfirmBtn = document.getElementById('closeDownloadConfirm');
  const downloadCancelBtn = document.getElementById('downloadCancelBtn');
  const downloadConfirmBtn = document.getElementById('downloadConfirmBtn');
  
  if (closeDownloadConfirmBtn) {
    closeDownloadConfirmBtn.onclick = closeDownloadConfirm;
  }
  if (downloadCancelBtn) {
    downloadCancelBtn.onclick = closeDownloadConfirm;
  }
  if (downloadConfirmBtn) {
    downloadConfirmBtn.onclick = confirmDownload;
  }
  
  // Load saved view mode or set default
  const savedMode = localStorage.getItem('viewMode') || 'grid';
  setViewMode(savedMode);
  
  
  // Check and show paste button if clipboard has data
  checkAndShowPasteButton();
  
  // Restore selection after rename (wait for script.js to load)
  setTimeout(function() {
    restoreSelectionAfterRename();
  }, 100);
});

// Check clipboard data and show paste button if available
function checkAndShowPasteButton() {
  // Try to load from localStorage first
  if (loadClipboardData()) {
    // Clipboard data loaded from localStorage
  }
  
  if (clipboardData.items && clipboardData.items.length > 0 && clipboardData.operation) {
    $('#pasteBtn').removeClass('d-none');
    // Show status
    const statusText = clipboardData.operation === 'copy' ? 'Copy' : 'Cut';
    $('#copyStatusText').text(`${statusText}: ${clipboardData.items.length} item(s)`);
    $('#copyStatus').removeClass('d-none');
  }
}

// Clear Copy button
$('#clearCopyBtn').on('click', function (e) {
  e.preventDefault()
  e.stopPropagation()
  
  // Clear clipboard data
  clipboardData.items = []
  clipboardData.sourcePath = ''
  clipboardData.operation = ''
  
  // Remove from localStorage
  localStorage.removeItem('clipboardData')
  
  // Hide copy status and paste button
  $('#copyStatus').addClass('d-none')
  $('#pasteBtn').addClass('d-none')
})

// Copy Path button
$('#copyPathBtn').on('click', function (e) {
  e.preventDefault()
  e.stopPropagation()
  
  let systemPath = $('#system_path').val()
  
  // Replace "://" with ":\" for Windows paths
  systemPath = systemPath.replace(/:\/\//g, ':\\')
  
  // Copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(systemPath).then(function() {
      // Show feedback
      const $btn = $(this)
      const originalText = $btn.html()
      $btn.html('<i class="fa-solid fa-check"></i> Copied!')
      $btn.addClass('btn-success').removeClass('btn-outline-light')
      
      setTimeout(function() {
        $btn.html(originalText)
        $btn.removeClass('btn-success').addClass('btn-outline-light')
      }, 2000)
    }.bind(this)).catch(function(err) {
      console.error('Failed to copy:', err)
      alert('Failed to copy path to clipboard')
    })
  } else {
    // Fallback for older browsers
    const textArea = document.createElement('textarea')
    // Replace "://" with ":\" for Windows paths
    let pathToCopy = $('#system_path').val().replace(/:\/\//g, ':\\')
    textArea.value = pathToCopy
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    document.body.appendChild(textArea)
    textArea.select()
    try {
      document.execCommand('copy')
      const $btn = $(this)
      const originalText = $btn.html()
      $btn.html('<i class="fa-solid fa-check"></i> Copied!')
      $btn.addClass('btn-success').removeClass('btn-outline-light')
      
      setTimeout(function() {
        $btn.html(originalText)
        $btn.removeClass('btn-success').addClass('btn-outline-light')
      }, 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      alert('Failed to copy path to clipboard')
    }
    document.body.removeChild(textArea)
  }
})

// Restore selection after rename
function restoreSelectionAfterRename() {
  const restoreData = localStorage.getItem('restoreSelection');
  if (restoreData) {
    try {
      const data = JSON.parse(restoreData);
      const newName = data.newName;
      const isFile = data.isFile;
      const isFolder = data.isFolder;
      const systemPath = data.systemPath;
      const currentPath = $('#system_path').val();
      
      // Only restore if we're in the same directory
      if (systemPath === currentPath) {
        // Wait a bit more for DOM and script.js to be fully ready
        setTimeout(function() {
          // Find the element with the new name
          const folderLinks = document.querySelectorAll('.folder-link');
          folderLinks.forEach(link => {
            const txtElement = link.querySelector('.txt');
            if (txtElement && txtElement.textContent.trim() === newName) {
              // Enable selection mode (from script.js)
              try {
                if (typeof wail_select !== 'undefined') {
                  wail_select = true;
                }
                
                // Add to selection arrays (from script.js)
                if (isFile) {
                  if (typeof selectedfile !== 'undefined' && !selectedfile.includes(newName)) {
                    selectedfile.push(newName);
                  }
                } else if (isFolder) {
                  if (typeof selectedItems !== 'undefined' && !selectedItems.includes(newName)) {
                    selectedItems.push(newName);
                  }
                }
              } catch (e) {
                console.log('Variables from script.js not yet loaded, will retry');
              }
              
              // Add visual selection
              const item = link.querySelector('.item');
              if (item) {
                if (!item.querySelector('.select-icon')) {
                  const icon = document.createElement('i');
                  icon.className = 'fa-solid fa-check select-icon';
                  item.appendChild(icon);
                  item.classList.add('is_select');
                }
              }
              
              // Show action buttons
              $('#selectDownload').removeClass('d-none');
              $('#renameBtn').removeClass('d-none');
              $('#deleteBtn').removeClass('d-none');
              
              // Add wait_select class
              $('.item').addClass('wait_select');
            }
          });
          
          // Clear restore data after restoring
          localStorage.removeItem('restoreSelection');
        }, 300);
      } else {
        // Clear restore data if path doesn't match
        localStorage.removeItem('restoreSelection');
      }
    } catch (e) {
      console.error('Error restoring selection:', e);
      localStorage.removeItem('restoreSelection');
    }
  }
}

// Toggle TabMenu Collapse/Expand

function setViewMode(mode) {
  currentViewMode = mode;
  const dropZone = document.getElementById('dropZone');
  const menuItems = document.querySelectorAll('.item_menu[data-view]');
  
  // Remove all view mode classes
  dropZone.classList.remove('view-grid', 'view-list-multi', 'view-list-vertical');
  
  // Add new view mode class
  dropZone.classList.add(`view-${mode}`);
  
  // Update active menu item
  menuItems.forEach(item => {
    if (item.getAttribute('data-view') === mode) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // If list-multi mode, create table view
  if (mode === 'list-multi') {
    // Hide all original items first
    const originalItems = dropZone.querySelectorAll('.folder-link, .item, .selection-box');
    originalItems.forEach(item => {
      if (item && item.style) {
        item.style.display = 'none';
        item.style.visibility = 'hidden';
        item.style.opacity = '0';
        item.style.height = '0';
        item.style.width = '0';
        item.style.margin = '0';
        item.style.padding = '0';
        item.style.overflow = 'hidden';
      }
    });
    
    // Create table view
    createTableView();
  } else {
    // Remove table if exists
    const existingTable = dropZone.querySelector('.table-container');
    if (existingTable) {
      existingTable.remove();
    }
    
    // Show original items again
    const originalItems = dropZone.querySelectorAll('.folder-link, .item, .selection-box');
    originalItems.forEach(item => {
      if (item && item.style) {
        item.style.display = '';
        item.style.visibility = '';
        item.style.opacity = '';
        item.style.height = '';
        item.style.width = '';
        item.style.margin = '';
        item.style.padding = '';
        item.style.overflow = '';
      }
    });
  }
  
  // Save to localStorage
  localStorage.setItem('viewMode', mode);
}

// Function to create table view for list-multi mode
function createTableView() {
  const dropZone = document.getElementById('dropZone');
  
  // Remove existing table if any
  const existingTable = dropZone.querySelector('.table-container');
  if (existingTable) {
    existingTable.remove();
  }
  
  // Ensure all original items are hidden before querying
  const allOriginalItems = dropZone.querySelectorAll('.folder-link, .item, .selection-box');
  allOriginalItems.forEach(item => {
    if (item && item.style) {
      item.style.display = 'none';
      item.style.visibility = 'hidden';
      item.style.opacity = '0';
      item.style.height = '0';
      item.style.width = '0';
      item.style.margin = '0';
      item.style.padding = '0';
      item.style.overflow = 'hidden';
    }
  });
  
  // Get all items (folders and files) - query from DOM before hiding
  const folders = Array.from(document.querySelectorAll('#dropZone .item_folder'));
  const files = Array.from(document.querySelectorAll('#dropZone .item:not(.item_folder)'));
  const allItems = [...folders, ...files];
  
  if (allItems.length === 0) {
    // Show message if no items
    const noItemsMsg = document.createElement('div');
    noItemsMsg.style.cssText = 'padding: 20px; text-align: center; color: #888; font-size: 14px;';
    noItemsMsg.textContent = 'No files or folders to display';
    dropZone.appendChild(noItemsMsg);
    return;
  }
  
  // Create table structure
  const tableContainer = document.createElement('div');
  tableContainer.className = 'table-container';
  
  const table = document.createElement('table');
  
  // Create header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `
    <th>#</th>
    <th>Name</th>
    <th>Download</th>
  `;
  thead.appendChild(headerRow);
  table.appendChild(thead);
  
  // Create body
  const tbody = document.createElement('tbody');
  
  allItems.forEach((item, index) => {
    const row = document.createElement('tr');
    row.className = 'selectable-item';
    
    // Get item info
    const link = item.closest('.folder-link');
    let systemPath = '';
    let itemName = '';
    let isFolder = false;
    let isFile = false;
    
    if (link) {
      // Try to get systemPath from onclick or ondblclick
      const onclickAttr = link.getAttribute('onclick') || '';
      const ondblclickAttr = link.getAttribute('ondblclick') || '';
      const pathMatch = onclickAttr.match(/'([^']+)'/) || ondblclickAttr.match(/'([^']+)'/);
      if (pathMatch) {
        systemPath = pathMatch[1];
      } else {
        // Fallback: get from system_path input
        const systemPathInput = document.getElementById('system_path');
        if (systemPathInput) {
          systemPath = systemPathInput.value;
        }
      }
      
      // Get item name
      const txtElement = item.querySelector('.txt');
      if (txtElement) {
        itemName = txtElement.textContent.trim();
      }
      
      // Check if folder or file
      isFolder = item.classList.contains('item_folder');
      isFile = !isFolder;
    }
    
    // Get icon
    let iconClass = 'fa-solid fa-file';
    let iconColor = '#f1f1f1';
    if (isFolder) {
      iconClass = 'fa-solid fa-folder';
      iconColor = '#1e89cb';
    } else {
      const icon = item.querySelector('i');
      if (icon) {
        iconClass = icon.className;
        // Get color from style if exists
        const style = icon.getAttribute('style');
        if (style && style.includes('color:')) {
          const colorMatch = style.match(/color:\s*([^;]+)/);
          if (colorMatch) {
            iconColor = colorMatch[1].trim();
          }
        }
      }
    }
    
    // Row number
    const tdNumber = document.createElement('td');
    tdNumber.textContent = index + 1;
    row.appendChild(tdNumber);
    
    // Name with icon
    const tdName = document.createElement('td');
    tdName.innerHTML = `
      <i class="${iconClass}" style="color: ${iconColor};"></i>
      <span class="item-name">${itemName}</span>
    `;
    row.appendChild(tdName);
    
    // Download button
    const tdDownload = document.createElement('td');
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-btn';
    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download';
    downloadBtn.onclick = function(e) {
      e.stopPropagation();
      showDownloadConfirm(systemPath, itemName, isFolder);
    };
    tdDownload.appendChild(downloadBtn);
    row.appendChild(tdDownload);
    
    // Add click handler for selection
    row.onclick = function(e) {
      if (e.target.closest('.download-btn')) return;
      handleTableItemClick(this, systemPath, itemName, isFolder ? 0 : 1);
    };
    
    // Store data attributes for easy access
    row.setAttribute('data-system-path', systemPath);
    row.setAttribute('data-item-name', itemName);
    row.setAttribute('data-is-folder', isFolder);
    
    tbody.appendChild(row);
  });
  
  table.appendChild(tbody);
  tableContainer.appendChild(table);
  dropZone.appendChild(tableContainer);
}

// Select All functionality
function selectAllItems() {
  if (!wail_select) {
    alert("Please enable selection mode first");
    return;
  }
  
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;
  
  const systemPath = document.getElementById('system_path').value;
  
  // Get all folder links (both folders and files are wrapped in .folder-link)
  const folderLinks = dropZone.querySelectorAll('.folder-link');
  
  // Select all items using handleClickSelect
  folderLinks.forEach(link => {
    const txt = link.querySelector('.txt');
    if (!txt) return;
    
    const itemName = txt.textContent.trim();
    if (!itemName) return;
    
    // Check if already selected
    const itemElement = link.querySelector('.item');
    if (itemElement && itemElement.classList.contains('is_select')) {
      return; // Already selected, skip
    }
    
    // Determine if it's a file or folder by checking onclick attribute or class
    let isFile = false;
    const onclickAttr = link.getAttribute('onclick');
    if (onclickAttr && onclickAttr.includes(',1)')) {
      isFile = true;
    } else if (link.querySelector('.item_file') || link.classList.contains('item_file')) {
      isFile = true;
    }
    
    // Call handleClickSelect to properly add to selection
    if (typeof handleClickSelect === 'function') {
      handleClickSelect(link, systemPath, itemName, isFile ? 1 : 0);
    }
  });
  
  // Update table view selection if active
  if (dropZone.classList.contains('view-list-multi')) {
    const rows = dropZone.querySelectorAll('table tbody tr');
    rows.forEach(row => {
      const nameCell = row.querySelector('.item-name');
      if (nameCell) {
        const itemName = nameCell.textContent.trim();
        if (selectedItems.includes(itemName) || selectedfile.includes(itemName)) {
          row.classList.add('selected');
        }
      }
    });
  }
  
  // Show action buttons
  updateActionButtonsVisibility();
  
  console.log("Selected all items - Folders:", selectedItems.length, "Files:", selectedfile.length);
}

// Update action buttons visibility based on selection
function updateActionButtonsVisibility() {
  const hasSelection = selectedItems.length > 0 || selectedfile.length > 0;
  
  // Show/hide dropdown items
  $('#selectDownload').toggleClass('d-none', !hasSelection);
  $('#copyBtn').toggleClass('d-none', !hasSelection);
  $('#cutBtn').toggleClass('d-none', !hasSelection);
  $('#renameBtn').toggleClass('d-none', !(selectedItems.length === 1 && selectedfile.length === 0) && !(selectedfile.length === 1 && selectedItems.length === 0));
  $('#deleteBtn').toggleClass('d-none', !hasSelection);
  
  // Show/hide OpenFile button
  if ((selectedfile.length === 1 && selectedItems.length === 0) || 
      (selectedItems.length === 1 && selectedfile.length === 0)) {
    $("#OpenFile").removeClass("d-none");
  } else {
    $("#OpenFile").addClass("d-none");
  }
}

// Handle table item click for selection
function handleTableItemClick(element, systemPath, itemName, isFile) {
  // Find the original item to trigger selection
  const dropZone = document.getElementById('dropZone');
  const originalItems = dropZone.querySelectorAll('.selectable-item');
  
  originalItems.forEach(item => {
    const txt = item.querySelector('.txt');
    if (txt && txt.textContent.trim() === itemName) {
      // Trigger click on original item for selection
      if (typeof handleClickSelect === 'function') {
        const link = item.closest('.folder-link');
        if (link) {
          handleClickSelect(link, systemPath, itemName, isFile);
        }
      }
      
      // Update table row selection
      const rows = document.querySelectorAll('.view-list-multi table tbody tr');
      rows.forEach(row => {
        row.classList.remove('selected');
        const nameCell = row.querySelector('.item-name');
        if (nameCell && nameCell.textContent.trim() === itemName) {
          row.classList.add('selected');
        }
      });
    }
  });
}

// Show download confirm dialog
function showDownloadConfirm(systemPath, itemName, isFolder) {
  const dialog = document.getElementById('downloadConfirmDialog');
  const message = document.getElementById('downloadConfirmMessage');
  
  message.textContent = `Are you sure you want to download "${itemName}"?`;
  
  dialog.style.display = 'flex';
  
  // Store download info
  window.pendingDownload = {
    systemPath: systemPath,
    itemName: itemName,
    isFolder: isFolder
  };
}

// Close download confirm dialog
function closeDownloadConfirm() {
  const dialog = document.getElementById('downloadConfirmDialog');
  dialog.style.display = 'none';
  window.pendingDownload = null;
}

// Handle download confirm
function confirmDownload() {
  if (!window.pendingDownload) return;
  
  const { systemPath, itemName, isFolder } = window.pendingDownload;
  
  if (isFolder) {
    // For folders, use the download_folders API
    if (typeof downloadSelectedFiles === 'function') {
      // Set selected items temporarily
      window.selectedItems = [itemName];
      window.selectedfile = [];
      downloadSelectedFiles();
    }
  } else {
    // For files, use download_one
    if (typeof download_one === 'function') {
      download_one(itemName);
    }
  }
  
  closeDownloadConfirm();
}

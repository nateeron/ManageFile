$(document).ready(function () {
    let isDragging = false;
    let startX, startY;
    let currentBoxLeft, currentBoxTop, currentBoxWidth, currentBoxHeight;
    let $dragArea = $(".drag-area");
    let $selectionBox = $dragArea.find(".selection-box");
    
    // If selection box doesn't exist, create it
    if ($selectionBox.length === 0) {
        $selectionBox = $('<div class="selection-box"></div>');
        $dragArea.append($selectionBox);
    }

    function startDrag(event) {
        // Prevent drag if clicking on interactive elements
        if ($(event.target).closest('.folder-link, .item, button, a, input, select').length) {
            return;
        }
        
        console.log("Drag started");
        isDragging = true;
        $(".selectable-item").removeClass("selected"); // Reset selections

        let touch = event.type === "touchstart" ? event.touches[0] : event;
        const dragAreaOffset = $dragArea.offset();
        startX = touch.pageX - dragAreaOffset.left;
        startY = touch.pageY - dragAreaOffset.top;

        console.log("Selection box start position:", {startX, startY, dragAreaOffset});

        $selectionBox.css({
            left: startX + "px",
            top: startY + "px",
            width: "0px",
            height: "0px",
            display: "block"
        });
    }

    function doDrag(event) {
        if (!isDragging) return;

        let touch = event.type === "touchmove" ? event.touches[0] : event;
        const dragAreaOffset = $dragArea.offset();
        const currentX = touch.pageX - dragAreaOffset.left;
        const currentY = touch.pageY - dragAreaOffset.top;

        let width = Math.abs(currentX - startX);
        let height = Math.abs(currentY - startY);
        let left = Math.min(startX, currentX);
        let top = Math.min(startY, currentY);
        
        // Store current box bounds
        currentBoxLeft = left;
        currentBoxTop = top;
        currentBoxWidth = width;
        currentBoxHeight = height;

        $selectionBox.css({ left, top, width, height });

        // Only check collision if selection box has size
        if (width > 5 && height > 5) {
            // Check if items are inside the selection box
            $(".selectable-item").each(function () {
                let $item = $(this);
                const itemOffset = $item.offset();
                const dragAreaOffset = $dragArea.offset();
                
                if (!itemOffset || !dragAreaOffset) return;
                
                // Calculate position relative to drag-area
                const itemLeft = itemOffset.left - dragAreaOffset.left;
                const itemTop = itemOffset.top - dragAreaOffset.top;
                const itemRight = itemLeft + $item.outerWidth();
                const itemBottom = itemTop + $item.outerHeight();
                
                // Check collision - item overlaps with selection box
                // Selection box: left, top, left+width, top+height
                // Item: itemLeft, itemTop, itemRight, itemBottom
                const overlaps = (
                    itemRight > left &&
                    itemLeft < left + width &&
                    itemBottom > top &&
                    itemTop < top + height
                );
                
                if (overlaps) {
                    $item.addClass("selected");
                } else {
                    $item.removeClass("selected");
                }
            });
        }

        event.preventDefault(); // Prevent touch scrolling
    }

    function endDrag(event) {
        if (!isDragging) return;
        
        isDragging = false;
        
        // Use stored box bounds from last doDrag
        const left = currentBoxLeft || 0;
        const top = currentBoxTop || 0;
        const width = currentBoxWidth || 0;
        const height = currentBoxHeight || 0;
        
        // Get all selected items within the selection box
        const selectedElements = [];
        $(".selectable-item.selected").each(function() {
            const $item = $(this);
            const $folderLink = $item.closest('.folder-link');
            if ($folderLink.length > 0) {
                selectedElements.push($folderLink);
            }
        });
        
        console.log("Selected elements count:", selectedElements.length);
        console.log("Selection box bounds:", {left, top, width, height});
        
        // Add selected items to selection arrays and show visual selection
        if (selectedElements.length > 0) {
            // Enable selection mode first (must be done before calling handleClickSelect)
            // Set wail_select to true to enable selection mode
            if (typeof wail_select !== 'undefined') {
                wail_select = true;
            } else {
                // If wail_select doesn't exist, create it
                window.wail_select = true;
            }
            
            // Also ensure selectedItems and selectedfile exist
            if (typeof selectedItems === 'undefined') {
                window.selectedItems = [];
            }
            if (typeof selectedfile === 'undefined') {
                window.selectedfile = [];
            }
            
            selectedElements.forEach(function($link) {
                // Get folder/file name from text content (most reliable)
                let folderName = null;
                let isFile = false;
                let systemPath = null;
                
                const $txt = $link.find('.txt');
                if ($txt.length > 0) {
                    folderName = $txt.text().trim();
                }
                
                // Check if it's a file by looking at onclick or ondblclick
                const onclickAttr = $link.attr('onclick');
                const ondblclickAttr = $link.attr('ondblclick');
                
                // Extract system path and file name from onclick
                if (onclickAttr) {
                    // Pattern: handleClickSelect(this,'system_path', 'folderName') or handleClickSelect(this,'system_path', 'fileName',1)
                    const match = onclickAttr.match(/'([^']+)'/g);
                    if (match && match.length >= 2) {
                        systemPath = match[0].replace(/'/g, ''); // First match is system_path
                        if (!folderName) {
                            folderName = match[1].replace(/'/g, ''); // Second match is folder/file name
                        }
                        // Check if it's a file (has ,1 parameter)
                        isFile = onclickAttr.includes(',1)') || onclickAttr.includes(', 1)');
                    }
                }
                
                // If still no folderName, try to get from text
                if (!folderName) {
                    const $txt = $link.find('.txt');
                    if ($txt.length > 0) {
                        folderName = $txt.text().trim();
                    }
                }
                
                // Check ondblclick for files
                if (ondblclickAttr && ondblclickAttr.includes('handleTextFileDoubleClick')) {
                    isFile = true;
                    // Extract file name and system path from ondblclick if not found
                    if (!folderName || !systemPath) {
                        const match = ondblclickAttr.match(/'([^']+)'/g);
                        if (match && match.length >= 2) {
                            if (!systemPath) systemPath = match[0].replace(/'/g, '');
                            if (!folderName) folderName = match[1].replace(/'/g, '');
                        }
                    }
                }
                
                console.log("Processing item:", folderName, "isFile:", isFile, "systemPath:", systemPath);
                console.log("wail_select:", typeof wail_select !== 'undefined' ? wail_select : 'undefined');
                console.log("handleClickSelect function exists:", typeof handleClickSelect === 'function');
                
                if (folderName && systemPath) {
                    // Use handleClickSelect to properly add to selection (same as clicking)
                    const itemType = isFile ? 1 : 0;
                    console.log("Calling handleClickSelect with:", {element: $link[0], systemPath, folderName, itemType});
                    
                    if (typeof handleClickSelect === 'function') {
                        try {
                            handleClickSelect($link[0], systemPath, folderName, itemType);
                            console.log("handleClickSelect called successfully");
                        } catch (error) {
                            console.error("Error calling handleClickSelect:", error);
                        }
                    } else {
                        // Fallback: manually add to selection
                        const itemIndex = (typeof selectedItems !== 'undefined') ? selectedItems.indexOf(folderName) : -1;
                        const itemfileIndex = (typeof selectedfile !== 'undefined') ? selectedfile.indexOf(folderName) : -1;
                        
                        if (itemIndex === -1 && itemfileIndex === -1) {
                            if (isFile) {
                                if (typeof selectedfile !== 'undefined') {
                                    selectedfile.push(folderName);
                                }
                            } else {
                                if (typeof selectedItems !== 'undefined') {
                                    selectedItems.push(folderName);
                                }
                            }
                            
                            // Add visual selection
                            const $item = $link.find('.item');
                            if (!$item.find('.select-icon').length) {
                                $item.append('<i class="fa-solid fa-check select-icon"></i>');
                                $item.addClass('is_select');
                            }
                        }
                    }
                }
            });
            
            // Show action buttons immediately after selection
            // Use setTimeout with 0 delay to ensure handleClickSelect has finished
            setTimeout(function() {
                // Try to access selectedItems and selectedfile from global scope
                let items = [];
                let files = [];
                
                if (typeof selectedItems !== 'undefined' && selectedItems && Array.isArray(selectedItems)) {
                    items = selectedItems;
                } else if (typeof window.selectedItems !== 'undefined' && window.selectedItems && Array.isArray(window.selectedItems)) {
                    items = window.selectedItems;
                }
                
                if (typeof selectedfile !== 'undefined' && selectedfile && Array.isArray(selectedfile)) {
                    files = selectedfile;
                } else if (typeof window.selectedfile !== 'undefined' && window.selectedfile && Array.isArray(window.selectedfile)) {
                    files = window.selectedfile;
                }
                
                const hasSelected = items.length > 0 || files.length > 0;
                
                console.log("Final check - Selected folders:", items);
                console.log("Final check - Selected files:", files);
                console.log("Has selected:", hasSelected);
                
                if (hasSelected) {
                    $("#selectDownload").removeClass("d-none");
                    $("#copyBtn").removeClass("d-none");
                    $("#cutBtn").removeClass("d-none");
                    $("#renameBtn").removeClass("d-none");
                    $("#deleteBtn").removeClass("d-none");
                    
                    // Show OpenFile button only when single file is selected (not folder)
                    // Show Open button when exactly one file OR one folder is selected
                    if ((selectedfile.length === 1 && selectedItems.length === 0) || 
                        (selectedItems.length === 1 && selectedfile.length === 0)) {
                        $("#OpenFile").removeClass("d-none");
                    } else {
                        $("#OpenFile").addClass("d-none");
                    }
                }
            }, 0);
        }
        
        // Remove selected class from all items
        $(".selectable-item").removeClass("selected");
        
        $selectionBox.fadeOut(200);
    }

    // Only start drag on empty area, not on items
    $dragArea.on("mousedown touchstart", function(e) {
        // Don't start drag if clicking on folder-link, item, button, or other interactive elements
        if ($(e.target).closest('.folder-link, .item, button, a, input, select').length) {
            return;
        }
        startDrag(e);
    });
    
    $(document).on("mousemove touchmove", doDrag);
    $(document).on("mouseup touchend", function(e) {
        // Prevent click event from clearing selection when ending drag
        if (isDragging) {
            // Mark that we're ending a drag operation
            $(document).data('endingDrag', true);
            endDrag(e);
            // Clear the flag after a short delay
            setTimeout(function() {
                $(document).data('endingDrag', false);
            }, 200);
        }
    });
});

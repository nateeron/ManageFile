$(document).ready(function () {
    let isDragging = false;
    let startX, startY;
    let $selectionBox = $(".selection-box");

    function startDrag(event) {
        isDragging = true;
        $(".selectable-item").removeClass("selected"); // Reset selections

        let touch = event.type === "touchstart" ? event.touches[0] : event;
        startX = touch.pageX;
        startY = touch.pageY;

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
        let currentX = touch.pageX;
        let currentY = touch.pageY;

        let width = Math.abs(currentX - startX);
        let height = Math.abs(currentY - startY);
        let left = Math.min(startX, currentX);
        let top = Math.min(startY, currentY);

        $selectionBox.css({ left, top, width, height });

        // Check if items are inside the selection box
        $(".selectable-item").each(function () {
            let $item = $(this);
            let itemOffset = $item.offset();
            let itemLeft = itemOffset.left;
            let itemTop = itemOffset.top;
            let itemRight = itemLeft + $item.outerWidth();
            let itemBottom = itemTop + $item.outerHeight();
            console.log($item)
            if (
                itemRight > left &&
                itemLeft < left + width &&
                itemBottom > top &&
                itemTop < top + height
            ) {
                $item.addClass("selected");
              
            } else {
                $item.removeClass("selected");
               
            }
        });

        event.preventDefault(); // Prevent touch scrolling
    }

    function endDrag() {
        isDragging = false;
        $selectionBox.fadeOut(200);
        // setTimeout(() => {
           
        // }, 100); // Hide the selection box after some time
    }

    $(".drag-area").on("mousedown touchstart", startDrag);
    $(document).on("mousemove touchmove", doDrag);
     $(document).on("mouseup touchend", endDrag);
});

import React, { useEffect, useRef } from 'react';

export const MobileSplitter: React.FC = () => {
  const isDragging = useRef(false);

  useEffect(() => {
    const handleMove = (clientY: number) => {
      // Find the topbar to calculate its height dynamically, fallback to 56px
      const topbar = document.querySelector('.topbar-container');
      const topbarHeight = topbar ? topbar.clientHeight : 56;
      
      const totalHeight = window.innerHeight - topbarHeight;
      if (totalHeight <= 0) return;

      const relativeY = clientY - topbarHeight;
      let ratio = (relativeY / totalHeight) * 100;
      
      // Clamp between 25% and 75% (maximum of 25% split for either side)
      ratio = Math.max(25, Math.min(75, ratio));
      
      if (topbar?.classList.contains('dashboard-topbar')) {
        document.documentElement.style.setProperty('--dashboard-map-ratio-mobile', `${ratio}%`);
      } else {
        document.documentElement.style.setProperty('--map-ratio-mobile', `${ratio}vh`);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      handleMove(e.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return;
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientY);
      }
    };

    const onMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.classList.remove('is-dragging-splitter');
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onMouseUp);
    };
  }, []);

  const handleStart = () => {
    isDragging.current = true;
    document.body.classList.add('is-dragging-splitter');
  };

  return (
    <div 
      className="mobile-splitter"
      onMouseDown={handleStart}
      onTouchStart={handleStart}
    >
      <div className="mobile-splitter-handle" />
    </div>
  );
};

export default MobileSplitter;

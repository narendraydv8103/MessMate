'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface PhotoCropModalProps {
  isOpen: boolean;
  imageFile: File | null;
  onSave: (croppedBlob: Blob) => Promise<void>;
  onCancel: () => void;
  isSaving?: boolean;
}

const CROP_DIAMETER = 280; // 280px round crop preview
const MAX_FILE_SIZE = 300 * 1024; // 300 KB limit
const MIN_ZOOM = 1.0;
const MAX_ZOOM = 3.0;

export default function PhotoCropModal({
  isOpen,
  imageFile,
  onSave,
  onCancel,
  isSaving = false,
}: PhotoCropModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<number>(MIN_ZOOM);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastDragPos = useRef<{ x: number; y: number } | null>(null);
  const initialPinchDist = useRef<number | null>(null);
  const pinchStartZoom = useRef<number>(MIN_ZOOM);

  // Derive format errors directly without triggering effects
  const formatError = useMemo(() => {
    if (!imageFile) return null;
    const fileNameLower = imageFile.name.toLowerCase();
    if (
      imageFile.type === 'image/heic' ||
      imageFile.type === 'image/heif' ||
      fileNameLower.endsWith('.heic') ||
      fileNameLower.endsWith('.heif')
    ) {
      return 'HEIC images are not directly supported by browsers. Please choose a JPEG, PNG, or WebP photo.';
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (imageFile.type && !allowedTypes.includes(imageFile.type) && !imageFile.type.startsWith('image/')) {
      return 'Invalid image format. Allowed formats are JPEG, PNG, and WebP.';
    }

    return null;
  }, [imageFile]);

  const activeError = formatError || runtimeError;

  // Helper to calculate clamped offset for given zoom & natural dimensions
  const getClampedOffset = useCallback(
    (targetX: number, targetY: number, targetZoom: number, natW: number, natH: number) => {
      const baseScale = Math.max(CROP_DIAMETER / natW, CROP_DIAMETER / natH);
      const totalScale = baseScale * targetZoom;
      const renderedW = natW * totalScale;
      const renderedH = natH * totalScale;

      const maxOffsetX = Math.max(0, (renderedW - CROP_DIAMETER) / 2);
      const maxOffsetY = Math.max(0, (renderedH - CROP_DIAMETER) / 2);

      const clampedX = Math.max(-maxOffsetX, Math.min(maxOffsetX, targetX));
      const clampedY = Math.max(-maxOffsetY, Math.min(maxOffsetY, targetY));

      return { x: clampedX, y: clampedY };
    },
    []
  );

  // When imageFile changes, create object URL and load image dimensions asynchronously
  useEffect(() => {
    if (!imageFile || formatError) {
      return;
    }

    const url = URL.createObjectURL(imageFile);
    const img = new Image();

    img.onload = () => {
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        setRuntimeError('Could not decode image dimensions. Please select a valid photo.');
        return;
      }
      setObjectUrl(url);
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setZoom(MIN_ZOOM);
      setOffset({ x: 0, y: 0 });
      setRuntimeError(null);
    };

    img.onerror = () => {
      setRuntimeError('Could not load this file as an image. Please select a valid JPEG, PNG, or WebP photo.');
    };

    img.src = url;

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [imageFile, formatError]);

  // Adjust zoom and re-clamp offset
  const handleZoomChange = useCallback(
    (newZoom: number) => {
      if (!naturalSize) return;
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      setZoom(clampedZoom);
      setOffset((prev) =>
        getClampedOffset(prev.x, prev.y, clampedZoom, naturalSize.width, naturalSize.height)
      );
    },
    [naturalSize, getClampedOffset]
  );

  // Pointer Events: Drag & Pinch-to-zoom
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSaving || !naturalSize) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore capture errors in unsupported environments
    }

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      lastDragPos.current = { x: e.clientX, y: e.clientY };
    } else if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      initialPinchDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartZoom.current = zoom;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSaving || !naturalSize) return;
    if (!activePointers.current.has(e.pointerId)) return;

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2 && initialPinchDist.current && initialPinchDist.current > 0) {
      // Pinch to zoom
      const pts = Array.from(activePointers.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = currentDist / initialPinchDist.current;
      handleZoomChange(pinchStartZoom.current * ratio);
    } else if (activePointers.current.size === 1 && lastDragPos.current) {
      // Drag repositioning
      const dx = e.clientX - lastDragPos.current.x;
      const dy = e.clientY - lastDragPos.current.y;
      lastDragPos.current = { x: e.clientX, y: e.clientY };

      setOffset((prev) =>
        getClampedOffset(prev.x + dx, prev.y + dy, zoom, naturalSize.width, naturalSize.height)
      );
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    if (activePointers.current.size === 1) {
      const remaining = Array.from(activePointers.current.values())[0];
      lastDragPos.current = { x: remaining.x, y: remaining.y };
      initialPinchDist.current = null;
    } else if (activePointers.current.size === 0) {
      lastDragPos.current = null;
      initialPinchDist.current = null;
    }
  };

  // Mouse wheel zoom on desktop
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (isSaving || !naturalSize) return;
    e.preventDefault();
    const zoomDelta = -e.deltaY * 0.0015;
    handleZoomChange(zoom + zoomDelta);
  };

  // Keyboard accessibility: Arrow keys to move, +/- to zoom, Escape to cancel
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isSaving || !naturalSize) return;
    const step = e.shiftKey ? 20 : 10;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setOffset((prev) =>
          getClampedOffset(prev.x - step, prev.y, zoom, naturalSize.width, naturalSize.height)
        );
        break;
      case 'ArrowRight':
        e.preventDefault();
        setOffset((prev) =>
          getClampedOffset(prev.x + step, prev.y, zoom, naturalSize.width, naturalSize.height)
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setOffset((prev) =>
          getClampedOffset(prev.x, prev.y - step, zoom, naturalSize.width, naturalSize.height)
        );
        break;
      case 'ArrowDown':
        e.preventDefault();
        setOffset((prev) =>
          getClampedOffset(prev.x, prev.y + step, zoom, naturalSize.width, naturalSize.height)
        );
        break;
      case '+':
      case '=':
        e.preventDefault();
        handleZoomChange(zoom + 0.1);
        break;
      case '-':
      case '_':
        e.preventDefault();
        handleZoomChange(zoom - 0.1);
        break;
      case 'Escape':
        e.preventDefault();
        onCancel();
        break;
      default:
        break;
    }
  };

  // On Save: export 256x256 JPEG quality 0.85
  const handleSaveClick = async () => {
    if (!naturalSize || !imgRef.current) return;
    setRuntimeError(null);

    try {
      const baseScale = Math.max(
        CROP_DIAMETER / naturalSize.width,
        CROP_DIAMETER / naturalSize.height
      );
      const totalScale = baseScale * zoom;
      const renderedW = naturalSize.width * totalScale;
      const renderedH = naturalSize.height * totalScale;

      // Image top-left relative to crop circle top-left
      const imgLeft = (CROP_DIAMETER - renderedW) / 2 + offset.x;
      const imgTop = (CROP_DIAMETER - renderedH) / 2 + offset.y;

      // Source rectangle inside the original natural image
      const srcX = -imgLeft / totalScale;
      const srcY = -imgTop / totalScale;
      const srcW = CROP_DIAMETER / totalScale;
      const srcH = CROP_DIAMETER / totalScale;

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context is unavailable.');
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgRef.current, srcX, srcY, srcW, srcH, 0, 0, 256, 256);

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Failed to encode cropped image.'));
          },
          'image/jpeg',
          0.85
        );
      });

      if (blob.size > MAX_FILE_SIZE) {
        throw new Error('Cropped image exceeds 300 KB limit. Please try zooming or compressing.');
      }

      await onSave(blob);
    } catch (err: unknown) {
      setRuntimeError(err instanceof Error ? err.message : 'Failed to crop and save image.');
    }
  };

  if (!isOpen) return null;

  // Computed layout values
  let renderedW = CROP_DIAMETER;
  let renderedH = CROP_DIAMETER;
  let imgLeft = 0;
  let imgTop = 0;

  if (naturalSize) {
    const baseScale = Math.max(
      CROP_DIAMETER / naturalSize.width,
      CROP_DIAMETER / naturalSize.height
    );
    const totalScale = baseScale * zoom;
    renderedW = naturalSize.width * totalScale;
    renderedH = naturalSize.height * totalScale;
    imgLeft = (CROP_DIAMETER - renderedW) / 2 + offset.x;
    imgTop = (CROP_DIAMETER - renderedH) / 2 + offset.y;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop and Adjust Photo"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        touchAction: 'none',
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '360px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          backgroundColor: 'var(--surface)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Adjust Profile Photo
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Drag to reposition, pinch or scroll to zoom
          </p>
        </div>

        {activeError && (
          <div
            role="alert"
            className="alert-bar alert-bar-danger"
            style={{ width: '100%', fontSize: '0.8rem', padding: '8px 12px' }}
          >
            {activeError}
          </div>
        )}

        {/* Circular Crop Area (280px) */}
        <div
          ref={containerRef}
          tabIndex={0}
          role="region"
          aria-label="Round photo crop preview. Use arrow keys to reposition and plus/minus to zoom."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          onWheel={handleWheel}
          data-testid="crop-container"
          style={{
            width: `${CROP_DIAMETER}px`,
            height: `${CROP_DIAMETER}px`,
            borderRadius: '50%',
            overflow: 'hidden',
            position: 'relative',
            cursor: isSaving ? 'wait' : 'grab',
            border: '3px solid var(--primary)',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
            touchAction: 'none',
            userSelect: 'none',
            backgroundColor: '#111',
            outline: 'none',
          }}
        >
          {objectUrl && naturalSize && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={objectUrl}
              alt="Photo preview"
              draggable={false}
              data-testid="crop-preview-image"
              style={{
                position: 'absolute',
                width: `${renderedW}px`,
                height: `${renderedH}px`,
                left: `${imgLeft}px`,
                top: `${imgTop}px`,
                maxWidth: 'none',
                maxHeight: 'none',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
          )}

          {!naturalSize && !activeError && (
            <div
              style={{
                display: 'flex',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.85rem',
              }}
            >
              Loading photo...
            </div>
          )}
        </div>

        {/* Zoom Slider & Controls (44px+ tap targets) */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '4px 0',
          }}
        >
          <button
            type="button"
            disabled={isSaving || zoom <= MIN_ZOOM}
            onClick={() => handleZoomChange(zoom - 0.2)}
            style={{
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              fontSize: '1.2rem',
              fontWeight: 600,
              cursor: isSaving || zoom <= MIN_ZOOM ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Zoom out"
          >
            -
          </button>

          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={isSaving || !naturalSize}
            onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
            style={{
              flex: 1,
              height: '44px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              accentColor: 'var(--primary)',
            }}
            aria-label="Zoom level"
            data-testid="zoom-slider"
          />

          <button
            type="button"
            disabled={isSaving || zoom >= MAX_ZOOM}
            onClick={() => handleZoomChange(zoom + 0.2)}
            style={{
              minWidth: '44px',
              minHeight: '44px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              fontSize: '1.2rem',
              fontWeight: 600,
              cursor: isSaving || zoom >= MAX_ZOOM ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        {/* Modal Action Buttons: Cancel & Save (44px+ tap targets) */}
        <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            style={{
              flex: 1,
              minHeight: '44px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: isSaving ? 'not-allowed' : 'pointer',
            }}
            id="btn-crop-cancel"
            data-testid="btn-crop-cancel"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isSaving || !naturalSize || Boolean(activeError)}
            onClick={handleSaveClick}
            style={{
              flex: 1,
              minHeight: '44px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: isSaving || !naturalSize || Boolean(activeError) ? 'not-allowed' : 'pointer',
              opacity: isSaving || !naturalSize || Boolean(activeError) ? 0.6 : 1,
            }}
            id="btn-crop-save"
            data-testid="btn-crop-save"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

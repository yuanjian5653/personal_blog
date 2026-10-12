"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMounted } from "@/lib/useMounted";

interface Props {
  images: string[];       // 完整 URL 数组
  index: number;
  onClose: () => void;
  onChangeIndex: (i: number) => void;
}

export default function LifeImageLightbox({
  images,
  index,
  onClose,
  onChangeIndex,
}: Props) {
  const mounted = useMounted();

  // 挂载后锁 body 滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // 缩放与平移都记下"属于哪张图"（at = 索引）。
  // 切图后 at 与 index 不再相等，读取时自然回落到默认值，
  // 因此不需要"切图就重置"的 effect，也不会先闪一帧旧缩放。
  const [zoom, setZoom] = useState<{ at: number; scale: number }>({
    at: 0,
    scale: 1,
  });
  const [panState, setPanState] = useState<{ at: number; x: number; y: number }>({
    at: 0,
    x: 0,
    y: 0,
  });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const scale = zoom.at === index ? zoom.scale : 1;
  const offset = panState.at === index ? { x: panState.x, y: panState.y } : { x: 0, y: 0 };

  /** 设置缩放；只影响当前这张图 */
  const setScale = (v: number | ((prev: number) => number)) =>
    setZoom((p) => {
      const base = p.at === index ? p.scale : 1;
      return { at: index, scale: typeof v === "function" ? v(base) : v };
    });

  /** 设置平移；只影响当前这张图 */
  const setOffset = (v: { x: number; y: number }) =>
    setPanState({ at: index, ...v });

  const resetZoom = () => {
    setZoom({ at: index, scale: 1 });
    setPanState({ at: index, x: 0, y: 0 });
  };

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        onChangeIndex((index - 1 + images.length) % images.length);
      } else if (e.key === "ArrowRight") {
        onChangeIndex((index + 1) % images.length);
      } else if (e.key === "0") {
        resetZoom();
      } else if (e.key === "+" || e.key === "=") {
        setScale((s) => Math.min(5, Number((s + 0.25).toFixed(2))));
      } else if (e.key === "-") {
        setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // resetZoom / setScale 依赖当前 index，这里显式列出以保持一致
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, images.length, onClose, onChangeIndex]);

  if (!mounted) return null;

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((s) => Math.max(0.5, Math.min(5, Number((s + delta).toFixed(2)))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX - offset.x,
      y: e.clientY - offset.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => setDragging(false);

  const handleDoubleClick = () => {
    if (scale > 1) resetZoom();
    else setScale(2);
  };

  const content = (
    <div
      className="life-lightbox"
      style={{ zIndex: 2147483647 }}
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 顶部工具栏 */}
      <div
        className="life-lightbox-toolbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="life-lightbox-counter">
          {index + 1} / {images.length}
        </div>

        <div className="life-lightbox-controls">
          <button
            onClick={() =>
              setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))
            }
            title="缩小"
          >
            −
          </button>
          <span className="life-lightbox-scale">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() =>
              setScale((s) => Math.min(5, Number((s + 0.25).toFixed(2))))
            }
            title="放大"
          >
            ＋
          </button>
          <button onClick={resetZoom} className="life-lightbox-reset" title="重置">
            重置
          </button>
        </div>

        <button
          className="life-lightbox-close"
          onClick={onClose}
          title="关闭（ESC）"
        >
          ×
        </button>
      </div>

      {/* 主视图 */}
      <div
        className="life-lightbox-stage"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onClick={(e) => e.stopPropagation()}
        style={{
          cursor: dragging ? "grabbing" : scale > 1 ? "grab" : "default",
        }}
      >
        <img
          src={images[index]}
          alt=""
          draggable={false}
          style={{
            maxWidth: "calc(100vw - 40px)",
            maxHeight: "calc(100vh - 160px)",
            width: "auto",
            height: "auto",
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 0.2s ease-out",
            objectFit: "contain",
            userSelect: "none",
            display: "block",
            filter: "drop-shadow(0 12px 40px rgba(0,0,0,0.5))",
          }}
        />

        {images.length > 1 && (
          <>
            <button
              className="life-lightbox-arrow left"
              onClick={(e) => {
                e.stopPropagation();
                onChangeIndex((index - 1 + images.length) % images.length);
              }}
              title="上一张（←）"
            >
              ‹
            </button>
            <button
              className="life-lightbox-arrow right"
              onClick={(e) => {
                e.stopPropagation();
                onChangeIndex((index + 1) % images.length);
              }}
              title="下一张（→）"
            >
              ›
            </button>
          </>
        )}
      </div>

      <div className="life-lightbox-hint">
        滚轮缩放 · 拖拽平移 · 双击重置 · ESC 关闭 · ←/→ 切换
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

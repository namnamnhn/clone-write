import { useEffect, RefObject } from 'react';

// Hook dùng chung (đề xuất cải thiện tồn đọng): đóng 1 popover/dropdown khi người dùng bấm ra
// ngoài vùng `ref`. Dùng `mousedown` (không phải `click`) để bắt sự kiện SỚM hơn, tránh trường
// hợp nút bấm MỞ popover (vd icon Cài đặt) và vùng "ngoài" trùng nhau gây mở-đóng nhấp nháy.
export const useOnClickOutside = (
    ref: RefObject<HTMLElement>,
    handler: () => void,
    enabled: boolean = true,
) => {
    useEffect(() => {
        if (!enabled) return;
        const listener = (event: MouseEvent) => {
            const el = ref.current;
            if (!el || el.contains(event.target as Node)) return;
            handler();
        };
        document.addEventListener('mousedown', listener);
        return () => document.removeEventListener('mousedown', listener);
    }, [ref, handler, enabled]);
};

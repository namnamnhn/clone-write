import React from 'react';

/**
 * Tạo 1 hàm setState "an toàn": vừa cập nhật React state (để re-render) vừa đồng bộ
 * NGAY LẬP TỨC giá trị mới vào stateRef.current[key] — để các hàm dùng closure cũ
 * (setTimeout, saveSession...) luôn đọc được giá trị mới nhất, tránh bug "stale closure"
 * (lưu nhầm dữ liệu cũ khi người dùng thao tác nhanh rồi chuyển tab/đóng trang).
 *
 * Trước đây useCoreState.ts có ~14 khối code khác nhau CHỈ khác mỗi tên field nhưng lặp
 * lại đúng 100% cùng 1 logic này (xem lịch sử git) — sửa 1 lỗi trong logic phải nhớ sửa
 * đủ cả 14 chỗ, rất dễ sót. Giờ chỉ có 1 chỗ duy nhất chứa logic thật sự.
 */
export function createSafeSetter<T>(
    key: string,
    setState: React.Dispatch<React.SetStateAction<T>>,
    stateRef: React.MutableRefObject<any>,
    sideEffect?: (next: T) => void,
) {
    return (action: React.SetStateAction<T>) => {
        const next = typeof action === 'function'
            ? (action as (prevState: T) => T)(stateRef.current[key])
            : action;
        stateRef.current[key] = next;
        setState(next);
        if (sideEffect) sideEffect(next);
    };
}

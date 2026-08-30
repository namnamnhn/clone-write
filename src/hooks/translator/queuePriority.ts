// FIX (starvation hàng chờ): trước đây MỌI tệp lỗi (kể cả tệp vừa bị "cách ly để kiểm tra
// riêng" hoặc đã xác nhận cần "Bàn giao DeepSeek") đều bị xếp chung xuống TẬN CUỐI
// hàng chờ giống như các tệp lỗi thường/"vạ lây". Với hàng chờ dài (hàng trăm tệp), điều này
// khiến các tệp cần cứu hộ có thể không bao giờ được thử lại riêng lẻ (batch 1 tệp qua
// DeepSeek) trước khi hết Quota hoặc hết phiên làm việc - dù đã add đủ API Key.
// Hàm này đưa các tệp "ưu tiên" (priorityIds) lên ĐẦU hàng chờ, các tệp lỗi thường còn lại vẫn
// giữ nguyên hành vi cũ (xuống cuối), để chúng được xử lý ngay ở lượt gom batch kế tiếp.
export const reorderQueueWithPriority = (prev: string[], retryingIds: string[], priorityIds: Set<string>): string[] => {
    if (retryingIds.length === 0) return prev;
    const priority = retryingIds.filter(id => priorityIds.has(id));
    const normal = retryingIds.filter(id => !priorityIds.has(id));
    if (priority.length === 0) {
        // Không có tệp ưu tiên nào - giữ nguyên hành vi cũ (toàn bộ xuống cuối)
        const otherIds = prev.filter(id => !retryingIds.includes(id));
        return [...otherIds, ...normal];
    }
    const otherIds = prev.filter(id => !retryingIds.includes(id));
    return [...priority, ...otherIds, ...normal];
};

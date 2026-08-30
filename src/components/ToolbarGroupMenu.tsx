import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

// TÁI CẤU TRÚC thanh công cụ dưới (yêu cầu người dùng, fix38): trước đây 20+ nút hành động nằm
// dàn hàng ngang liên tục trong 1 thanh cuộn ngang, rất khó quét mắt tìm đúng nút cần trên màn
// hình nhỏ/tablet. Component này bọc MỘT NHÓM nút đã có sẵn (giữ nguyên 100% onClick/disabled/
// title của từng nút con — chỉ đổi CÁCH HIỂN THỊ) thành 1 nút nhãn nhóm + panel thả lên khi bấm,
// để mặc định thanh công cụ chỉ hiện vài nút nhãn nhóm gọn gàng thay vì toàn bộ nút con.
interface ToolbarGroupMenuProps {
    label: string;
    icon?: React.ReactNode;
    badgeCount?: number; // Hiện chấm số đỏ trên nhãn nhóm ngay cả khi đang đóng (vd số file cần Smart Fix)
    highlight?: boolean; // Tô màu nhãn nhóm khi có trạng thái đặc biệt bên trong (vd đang lọc, đang chạy Auto)
    // THÊM (fix38, đề xuất "phím tắt mở nhanh nhóm toolbar"): mỗi nhóm có thể khai báo 1 phím số
    // (vd "1") để mở/đóng panel bằng Alt+phím đó, không cần rê chuột. Optional — nhóm nào không
    // truyền shortcutKey thì không có phím tắt, hành vi bấm chuột giữ nguyên 100% như cũ.
    shortcutKey?: string;
    children: React.ReactNode;
}

export const ToolbarGroupMenu: React.FC<ToolbarGroupMenuProps> = ({ label, icon, badgeCount, highlight, shortcutKey, children }) => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState<{ left: number; bottom: number; ready: boolean } | null>(null);

    // FIX (bug thực tế báo 23/8: bấm nút nhóm hoàn toàn không có phản hồi) — nguyên nhân: thanh
    // công cụ dưới cùng cuộn NGANG (`overflow-x-auto`). Theo chuẩn CSS, hễ 1 trục overflow khác
    // 'visible' thì trục còn lại KHÔNG THỂ giữ 'visible' nữa mà bị trình duyệt tự ép thành 'auto'
    // — tức khung này vô tình bị cắt theo chiều DỌC luôn dù không hề khai overflow-y. Panel thả
    // LÊN TRÊN nút (position absolute, bottom-full) nằm ngoài khung đó nên bị cắt mất hoàn toàn —
    // về mặt state thì nút vẫn bấm đúng (open vẫn đổi), chỉ là không có gì hiện ra nên nhìn như vô
    // tri giác. Sửa bằng cách "thoát" panel ra khỏi khung cuộn: render qua React Portal thẳng vào
    // <body>, định vị bằng toạ độ thật của nút (getBoundingClientRect) với position: fixed — không
    // còn bị bất kỳ overflow của khung cha nào cắt nữa.
    //
    // FIX TIẾP (yêu cầu người dùng: panel bị "khuất"/cắt cụt chữ ở nút gần rìa phải màn hình) —
    // canh trái tuyệt đối theo mép trái nút (như bản trước) khiến panel dễ tràn ra ngoài viewport
    // với các nhóm nằm gần rìa phải (vd "Xuất"). Đổi sang định vị 2 bước kiểu popper: bước 1 đặt
    // panel tạm ở ngoài màn hình (không thấy được) chỉ để ĐO kích thước thật; bước 2 dùng kích
    // thước đo được để CĂN GIỮA panel theo tâm nút bấm, rồi GHIM lại trong viewport (không tràn
    // trái/phải) — nút ở giữa màn hình thì panel canh giữa dưới nút, nút ở sát rìa thì panel tự
    // lùi vào để không bị cắt.
    useLayoutEffect(() => {
        if (!open || !triggerRef.current) return;
        setCoords({ left: -9999, bottom: -9999, ready: false });

        const handleScrollOrResize = () => setOpen(false);
        // Đóng panel khi cuộn/resize thay vì tính lại toạ độ liên tục theo mọi khung cuộn cha có
        // thể có — đơn giản và an toàn hơn, tránh panel "trôi" lệch khỏi nút gốc.
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);
        return () => {
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [open]);

    // Bước 2 của định vị: chạy SAU khi panel đã render (ẩn ngoài màn hình) nên panelRef đã có
    // kích thước thật để đo — tính lại toạ độ căn giữa + ghim trong viewport rồi mới hiện ra.
    useLayoutEffect(() => {
        if (!open || !coords || coords.ready) return;
        if (!triggerRef.current || !panelRef.current) return;
        const margin = 8;
        const triggerRect = triggerRef.current.getBoundingClientRect();
        const panelRect = panelRef.current.getBoundingClientRect();
        let left = triggerRect.left + triggerRect.width / 2 - panelRect.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin));
        const bottom = window.innerHeight - triggerRect.top + margin;
        setCoords({ left, bottom, ready: true });
    }, [open, coords]);

    useEffect(() => {
        if (!open) return;
        const handleOutsideClick = (e: MouseEvent) => {
            const target = e.target as Node;
            // Panel giờ nằm trong portal (con của <body>, không còn là con DOM của nút nhãn
            // nhóm) nên phải kiểm tra CẢ 2 ref — nút trigger lẫn panel — mới coi là "bên trong".
            if (triggerRef.current?.contains(target)) return;
            if (panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        // Đóng panel khi bấm ra ngoài — không dùng onBlur vì onBlur sẽ đóng panel TRƯỚC KHI kịp
        // nhận click vào 1 nút con bên trong panel (blur xảy ra ngay khi rời focus khỏi trigger).
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [open]);

    // THÊM (fix38): phím tắt Alt+<shortcutKey> mở/đóng nhóm này mà không cần bấm chuột. Bỏ qua
    // khi người dùng đang gõ trong input/textarea/select/contentEditable để không phá thao tác
    // gõ chữ bình thường (vd Alt+1 khi đang gõ ghi chú không được nuốt mất ký tự "1").
    useEffect(() => {
        if (!shortcutKey) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.key.toLowerCase() !== shortcutKey.toLowerCase()) return;
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
            e.preventDefault();
            setOpen(o => !o);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [shortcutKey]);

    return (
        <div className="relative shrink-0">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(o => !o)}
                title={shortcutKey ? `Phím tắt: Alt+${shortcutKey}` : undefined}
                className={`flex items-center gap-1.5 h-10 px-3 rounded-xl font-bold text-[10px] uppercase tracking-tight transition-all duration-200 ease-smooth border active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
                    open || highlight
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary-200 dark:border-primary-800'
                        : 'bg-slate-50 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
            >
                {icon}
                <span>{label}</span>
                {typeof badgeCount === 'number' && badgeCount > 0 && (
                    <span className="min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold shadow-sm">
                        {badgeCount}
                    </span>
                )}
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && coords && createPortal(
                <div
                    ref={panelRef}
                    style={{
                        position: 'fixed',
                        left: coords.left,
                        bottom: coords.bottom,
                        zIndex: 9999,
                        // Ẩn (nhưng vẫn render để đo được kích thước thật) trong lúc chưa tính
                        // xong vị trí căn giữa/ghim viewport ở bước 2 — tránh panel "nhấp nháy"
                        // hiện tạm ở vị trí sai rồi mới nhảy sang vị trí đúng.
                        opacity: coords.ready ? 1 : 0,
                        pointerEvents: coords.ready ? 'auto' : 'none',
                    }}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-elevation-2 p-1.5 flex items-center gap-1 min-w-max max-w-[90vw] overflow-x-auto custom-scrollbar"
                >
                    {children}
                </div>,
                document.body
            )}
        </div>
    );
};

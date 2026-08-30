import React, { useState } from 'react';
import { X, GraduationCap, Info, Play, Zap, HelpCircle, Brain, Sparkles, ShieldCheck, Hammer, BookOpen, RefreshCw, Layout, AlertCircle } from 'lucide-react';

export interface GuideModalProps { isOpen: boolean; onClose: () => void; }
export const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => { 
    const [activeTab, setActiveTab] = useState<'intro' | 'flow' | 'features' | 'faq' | 'detailed'>('intro'); 
    if (!isOpen) return null; 
    return ( 
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"> 
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-white/40 ring-1 ring-black/50"> 
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-indigo-50"> 
                    <div className="flex items-center gap-3"> 
                        <div className="p-2 bg-white rounded-xl shadow-sm text-blue-600"><GraduationCap className="w-6 h-6" /></div> 
                        <div> <h3 className="font-display font-bold text-lg text-slate-800">Hướng Dẫn Sử Dụng (Dành Cho Người Mới)</h3> </div> 
                    </div> 
                    <button onClick={onClose} className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button> 
                </div> 
                {/* Tabs */}
                <div className="flex border-b border-slate-100 bg-white overflow-x-auto no-scrollbar shrink-0"> 
                    <button onClick={() => setActiveTab('intro')} className={`flex-1 min-w-[120px] py-4 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${activeTab === 'intro' ? 'border-sky-500 text-sky-600 bg-sky-50/30' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                        <Info className="w-4 h-4"/> Tổng Quan
                    </button> 
                    <button onClick={() => setActiveTab('flow')} className={`flex-1 min-w-[120px] py-4 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${activeTab === 'flow' ? 'border-indigo-500 text-indigo-600 bg-indigo-50/30' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                        <Play className="w-4 h-4"/> Quy Trình 4 Bước
                    </button> 
                    <button onClick={() => setActiveTab('detailed')} className={`flex-1 min-w-[120px] py-4 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${activeTab === 'detailed' ? 'border-emerald-500 text-emerald-600 bg-emerald-50/30' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                        <BookOpen className="w-4 h-4"/> Hướng Dẫn Chi Tiết
                    </button>
                    <button onClick={() => setActiveTab('features')} className={`flex-1 min-w-[120px] py-4 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${activeTab === 'features' ? 'border-purple-500 text-purple-600 bg-purple-50/30' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                        <Zap className="w-4 h-4"/> Tính Năng Hay
                    </button> 
                    <button onClick={() => setActiveTab('faq')} className={`flex-1 min-w-[120px] py-4 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${activeTab === 'faq' ? 'border-rose-500 text-rose-600 bg-rose-50/30' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                        <HelpCircle className="w-4 h-4"/> Hỏi Đáp & Lỗi
                    </button> 
                </div> 
                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 custom-scrollbar text-sm leading-relaxed text-slate-700">
                    {/* TAB 1: INTRO */}
                    {activeTab === 'intro' && (
                        <div className="space-y-8 animate-in fade-in duration-300">
                            <div className="text-center space-y-3 mb-8">
                                <h4 className="font-display font-bold text-2xl text-slate-800">Chào mừng bạn đến với Thế Giới Biên Tập AI</h4>
                                <p className="text-slate-500 max-w-2xl mx-auto">
                                    Đây không phải là Google Translate. Đây là một <b>"Xưởng Biên Tập Ảo"</b> nơi AI đóng vai trò là Biên tập viên chuyên nghiệp, giúp bạn dịch và chỉnh sửa truyện với văn phong như người thật.
                                </p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
                                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 mb-4"><Brain className="w-6 h-6"/></div>
                                    <h5 className="font-bold text-lg text-slate-800 mb-2">Thông Minh Hơn</h5>
                                    <p className="text-slate-600">AI hiểu ngữ cảnh, tự động nhận biết tên nhân vật, chiêu thức và xưng hô (Huynh/Muội, Ta/Nàng) tùy theo thể loại truyện.</p>
                                </div>
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
                                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-4"><Sparkles className="w-6 h-6"/></div>
                                    <h5 className="font-bold text-lg text-slate-800 mb-2">Văn Phong Sách In</h5>
                                    <p className="text-slate-600">Không còn văn phong "máy móc". AI được huấn luyện để viết văn chương trôi chảy, giàu cảm xúc, chuẩn định dạng xuất bản.</p>
                                </div>
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
                                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 mb-4"><Zap className="w-6 h-6"/></div>
                                    <h5 className="font-bold text-lg text-slate-800 mb-2">Tự Động Hóa (Auto)</h5>
                                    <p className="text-slate-600">Chỉ cần 1 cú click chuột. Hệ thống sẽ tự động Phân tích → Dịch → Sửa lỗi → Định dạng mà bạn không cần can thiệp.</p>
                                </div>
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
                                    <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mb-4"><ShieldCheck className="w-6 h-6"/></div>
                                    <h5 className="font-bold text-lg text-slate-800 mb-2">An Toàn & Riêng Tư</h5>
                                    <p className="text-slate-600">Dữ liệu của bạn được lưu ngay trên trình duyệt (Local). Không ai có thể xem nội dung truyện của bạn.</p>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* TAB 2: FLOW */}
                    {activeTab === 'flow' && (
                        <div className="space-y-8 animate-in fade-in duration-300">
                            <h4 className="font-bold text-xl text-indigo-700 mb-4">Quy Trình 4 Bước Đơn Giản</h4>
                            
                            <div className="relative border-l-2 border-slate-200 ml-3 space-y-10 pl-8 py-2">
                                {/* Step 1 */}
                                <div className="relative">
                                    <span className="absolute -left-[41px] w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold text-sm ring-4 ring-white">1</span>
                                    <h5 className="font-bold text-lg text-slate-800">Nhập Liệu (Import)</h5>
                                    <p className="text-slate-600 mt-1">Kéo thả file truyện (TXT, DOCX, EPUB, PDF) vào màn hình chính. Nếu file quá lớn, App sẽ tự động cắt nhỏ.</p>
                                    <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 border border-blue-100">
                                        💡 Mẹo: Nên đặt tên file chuẩn (VD: "Chuong 1.txt") để App tự nhận diện số chương.
                                    </div>
                                </div>
                                {/* Step 2 */}
                                <div className="relative">
                                    <span className="absolute -left-[41px] w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-sm ring-4 ring-white">2</span>
                                    <h5 className="font-bold text-lg text-slate-800">Cấu Hình Tự Động (Auto Setup)</h5>
                                    <p className="text-slate-600 mt-1">Nhấn nút màu vàng <b className="text-amber-600">AUTO</b> ở dưới cùng. Đây là bước quan trọng nhất.</p>
                                    <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600">
                                        <li><b>Auto Phân Tích:</b> AI đọc lướt truyện để tìm tên Nhân vật, Địa danh, Cấp độ.</li>
                                        <li><b>Prompt Architect:</b> AI tự thiết kế "Câu lệnh" (Prompt) dịch thuật tối ưu cho riêng truyện này.</li>
                                    </ul>
                                </div>
                                {/* Step 3 */}
                                <div className="relative">
                                    <span className="absolute -left-[41px] w-8 h-8 rounded-full bg-indigo-500 text-white flex items-center justify-center font-bold text-sm ring-4 ring-white">3</span>
                                    <h5 className="font-bold text-lg text-slate-800">Chạy Dịch Thuật (Run)</h5>
                                    <p className="text-slate-600 mt-1">Sau khi Auto xong, nhấn <b>"Chạy Tự Động"</b> hoặc đóng cửa sổ Auto và nhấn nút <b>"BẮT ĐẦU"</b> ở góc phải.</p>
                                    <div className="mt-3 flex gap-4">
                                        <div className="flex-1 bg-slate-100 p-3 rounded-lg text-xs">
                                            <b className="block text-slate-700 mb-1">Flash Mode</b>
                                            Tốc độ cao. Dùng cho bản nháp hoặc truyện dễ.
                                        </div>
                                        <div className="flex-1 bg-indigo-50 p-3 rounded-lg text-xs border border-indigo-100">
                                            <b className="block text-indigo-700 mb-1">Normal Mode (Khuyên dùng)</b>
                                            Cân bằng. Dịch bằng model xịn, sửa lỗi bằng model nhanh.
                                        </div>
                                    </div>
                                </div>
                                {/* Step 4 */}
                                <div className="relative">
                                    <span className="absolute -left-[41px] w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-sm ring-4 ring-white">4</span>
                                    <h5 className="font-bold text-lg text-slate-800">Xuất Bản (Export)</h5>
                                    <p className="text-slate-600 mt-1">Khi dịch xong (File hiện màu xanh lá), bạn có thể tải về.</p>
                                    <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600">
                                        <li><b>EPUB:</b> Tạo Ebook chuẩn có mục lục và bìa (để đọc trên điện thoại/Kindle).</li>
                                        <li><b>GỘP:</b> Tạo 1 file .txt duy nhất chứa tất cả chương.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* TAB DETAILED */}
                    {activeTab === 'detailed' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <h4 className="font-bold text-xl text-emerald-700 mb-4">Các bước và quy trình chuyên nghiệp để sử dụng app hiệu quả</h4>
                            
                            <div className="space-y-4">
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <ol className="list-decimal pl-5 space-y-3 text-slate-700">
                                        <li>Nên chuẩn bị tối thiểu 5 acc gmail khác nhau.</li>
                                        <li>Trình duyệt Chrome hoặc tương tự -&gt; Tạo 5 profile, mỗi profile là 1 gmail tương ứng (nếu chưa biết cách tạo hỏi Gemini)</li>
                                        <li>Tải tệp cần dịch lên (dạng zip từng tệp txt hoặc epub xuất ở vbook) -&gt; Nhấn auto -&gt; chọn các bước phân tích nhanh, phân tích chuyên sâu ngữ cảnh, thiết kế prompt (Nhớ kiểm tra ngôn ngữ truyện để tránh nhầm lẫn giữa raw và convert để đảm bảo phân tích ngữ cảnh và thiết kế prompt chuẩn nhất)</li>
                                        <li>Backup lại thông tin</li>
                                        <li>Tiến hành chia file cần dịch. Tốt nhất là dạng zip từng tệp txt. Chia thành 4 tệp zip nhỏ.</li>
                                        <li>
                                            Mở 4 profile còn nguyên quota. Restore lại file backup. Mỗi profile là 1 tệp zip đã được chia nhỏ. Chỉnh sửa tên mỗi phần ở mục thông tin thành dạng. Để dễ tạo epub lúc cuối.
                                            <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600">
                                                <li>Tên truyện (1)</li>
                                                <li>Tên truyện (2)</li>
                                                <li>Tên truyện (3)</li>
                                                <li>Tên truyện (4)</li>
                                            </ul>
                                        </li>
                                        <li>Auto chọn chế độ normal và chờ thành quả -&gt; hết quota thì backup xong restore qua profile khác nếu còn. Auto tiếp.</li>
                                        <li>Sau khi dịch xong hết ở mỗi tệp -&gt; chọn tải gộp txt về.</li>
                                        <li>Mở app tạo epub -&gt; điền thông tin Tên truyện, tác giả, ảnh bìa. Chỗ tệp chọn hết 4 tệp txt đã tải về -&gt; nhấn tạo epub. Xong</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* TAB 3: FEATURES */}
                    {activeTab === 'features' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <h4 className="font-bold text-xl text-purple-700 mb-4">Các Công Cụ Quyền Năng</h4>
                            
                            <div className="grid grid-cols-1 gap-4">
                                <div className="flex gap-4 bg-white p-4 rounded-xl border border-slate-200">
                                    <div className="p-3 bg-amber-100 text-amber-600 rounded-lg h-fit"><Hammer className="w-5 h-5"/></div>
                                    <div>
                                        <h5 className="font-bold text-slate-800">Smart Fix (Sửa Lỗi Thông Minh)</h5>
                                        <p className="text-slate-600 mt-1">Nút hình cái búa. Dùng khi file đã dịch xong nhưng vẫn còn sót tiếng Trung/Anh hoặc lỗi xưng hô. Nó sẽ quét và sửa lại mà không cần dịch lại từ đầu.</p>
                                    </div>
                                </div>
                                <div className="flex gap-4 bg-white p-4 rounded-xl border border-slate-200">
                                    <div className="p-3 bg-blue-100 text-blue-600 rounded-lg h-fit"><BookOpen className="w-5 h-5"/></div>
                                    <div>
                                        <h5 className="font-bold text-slate-800">Tab Tri Thức (Knowledge Base)</h5>
                                        <p className="text-slate-600 mt-1">Nơi chứa "Bộ não" của AI. Bạn có thể vào đây để sửa tên nhân vật (Glossary) hoặc thêm ghi chú ngữ cảnh (Context) nếu AI dịch sai tên.</p>
                                    </div>
                                </div>
                                <div className="flex gap-4 bg-white p-4 rounded-xl border border-slate-200">
                                    <div className="p-3 bg-rose-100 text-rose-600 rounded-lg h-fit"><RefreshCw className="w-5 h-5"/></div>
                                    <div>
                                        <h5 className="font-bold text-slate-800">Dịch Lại & Cứu Hộ</h5>
                                        <p className="text-slate-600 mt-1">Nếu 1 chương dịch quá tệ? Chọn file đó và nhấn nút "Dịch Lại". Hoặc dùng nút "Cứu Hộ" (Phao cứu sinh) trong Editor để copy prompt và nhờ ChatGPT bên ngoài dịch hộ.</p>
                                    </div>
                                </div>
                                <div className="flex gap-4 bg-white p-4 rounded-xl border border-slate-200">
                                    <div className="p-3 bg-indigo-100 text-indigo-600 rounded-lg h-fit"><Layout className="w-5 h-5"/></div>
                                    <div>
                                        <h5 className="font-bold text-slate-800">Editor Song Song</h5>
                                        <p className="text-slate-600 mt-1">Bấm vào tên file để mở trình chỉnh sửa. Bên trái là bản gốc, bên phải là bản dịch. Có chế độ soi lỗi Raw và đồng bộ cuộn.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* TAB 4: FAQ */}
                    {activeTab === 'faq' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <h4 className="font-bold text-xl text-rose-700 mb-4">Các Lỗi Thường Gặp & Cách Xử Lý</h4>
                            
                            <div className="space-y-4">
                                <div className="bg-rose-50 p-4 rounded-xl border border-rose-100">
                                    <h5 className="font-bold text-rose-800 flex items-center gap-2"><AlertCircle className="w-4 h-4"/> Lỗi 429 (Resource Exhausted)</h5>
                                    <p className="text-slate-700 mt-2 text-sm">
                                        <b>Nguyên nhân:</b> Google giới hạn số lượt dùng miễn phí mỗi phút/ngày. <br/>
                                        <b>Giải pháp:</b> App có tính năng <b>Smart Wait</b>. Nếu thấy huy hiệu trên cùng hiện "Chờ 60s", hãy kiên nhẫn. App đang "ngủ" để hồi phục. Đừng tắt tab.
                                    </p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                    <h5 className="font-bold text-slate-800 flex items-center gap-2"><HelpCircle className="w-4 h-4"/> Dịch bị sót tên, sai xưng hô?</h5>
                                    <p className="text-slate-600 mt-2 text-sm">
                                        Vào Tab <b>Tri Thức</b> → Sửa lại trong bảng Từ Điển (Glossary). Sau đó chọn các file bị sai và nhấn <b>Smart Fix</b>.
                                    </p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                    <h5 className="font-bold text-slate-800 flex items-center gap-2"><HelpCircle className="w-4 h-4"/> Có cần treo máy không?</h5>
                                    <p className="text-slate-600 mt-2 text-sm">
                                        <b>Có.</b> Vì đây là Web App chạy trên trình duyệt của bạn, bạn cần giữ Tab mở để nó hoạt động. Tuy nhiên, bạn có thể chuyển sang Tab khác làm việc, nó vẫn chạy ngầm.
                                    </p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                    <h5 className="font-bold text-slate-800 flex items-center gap-2"><HelpCircle className="w-4 h-4"/> Làm sao để lưu dữ liệu?</h5>
                                    <p className="text-slate-600 mt-2 text-sm">
                                        App tự động lưu sau mỗi 2 giây. Nhưng để chắc ăn, hãy nhấn nút <b>Backup (.json)</b> ở Tab <b>Thông Tin</b> để tải file dự phòng về máy tính.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div> 
            </div> 
        </div> 
    ); 
};

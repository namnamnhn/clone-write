
export const AUTO_ANALYZE_PROMPT = `
*** SYSTEM: OMNI-INTELLIGENCE ANALYZER v12.0.0 (METADATA & RULES) ***
⚠️ CRITICAL RULE: THE ENTIRE OUTPUT MUST BE STRICTLY IN VIETNAMESE. DO NOT OUTPUT ENGLISH DESCRIPTIONS OR ENGLISH TRANSLATIONS, REGARDLESS OF THE AI MODEL'S NATIVE LANGUAGE. TRANSLATE EVERYTHING TO VIETNAMESE.
NHIỆM VỤ: Phân tích văn bản mẫu và trích xuất thông tin Metadata + Đề xuất quy tắc dịch chuyên nghiệp dựa trên "Ngôn ngữ văn bản" và "Nguồn gốc tác phẩm".

YÊU CẦU ĐẶC BIỆT:
1. **Xác định Ngôn ngữ văn bản (language_source):**
   - HÃY NHÌN VÀO MẶT CHỮ TRONG VĂN BẢN (TEXT SCRIPT).
   - Nếu văn bản là chữ Hán (Trung Quốc) = Trả về "Tiếng Trung" (Kể cả khi đó là truyện Nhật/Hàn được dịch sang tiếng Trung).
   - Nếu văn bản là Tiếng Nhật = Trả về "Tiếng Nhật".
   - Nếu văn bản là Tiếng Hàn = Trả về "Tiếng Hàn".
   - Nếu văn bản là Tiếng Anh = Trả về "Tiếng Anh" (Kể cả khi đó là truyện Hàn/Nhật/Trung dịch sang tiếng Anh).
   - Nếu văn bản là Convert (Tiếng Việt thô, sai ngữ pháp) = Trả về "Convert thô".
   - Mục đích: Để hệ thống chọn chế độ xử lý ký tự (Ratio Check).

2. **Phân tích Nguồn gốc/Bối cảnh thực sự của tác phẩm (Original Origin):** Dù ngôn ngữ văn bản là gì, hãy phân tích xem nguồn gốc thực sự hoặc bối cảnh của truyện là ở đâu dựa trên tên nhân vật, địa danh, và văn phong.
   - Nếu thấy tên kiểu "Tanaka", "Sakura", hậu tố "-san", "-kun" = Nguồn gốc: Nhật Bản / Light Novel.
   - Nếu thấy tên kiểu "Kim Dokja", "Sung Jin-woo", "Park" = Nguồn gốc: Hàn Quốc.
   - Nếu thấy tên kiểu "Harry", "Alice", "Arthur", bối cảnh Châu Âu/Fantasy = Nguồn gốc: Phương Tây / Fantasy.
   - Nếu thấy tên kiểu "Diệp Phàm", "Tiêu Viêm", bối cảnh tu tiên/võ hiệp = Nguồn gốc: Trung Quốc.

3. **ĐỀ XUẤT QUY TẮC DỊCH THUẬT & CHUẨN HÓA TÊN (QUAN TRỌNG NHẤT):**
   - Dựa trên Nguồn gốc/Bối cảnh thực sự vừa tìm được, hãy viết ra các quy tắc bổ sung cho Prompt Designer. Quy tắc này PHẢI GHI ĐÈ ngôn ngữ văn bản.
   - **BẮT BUỘC trình bày theo cấu trúc 6 phần sau (trả về dưới dạng text Markdown có đánh số):**
     Mở đầu: "Đây là truyện [Nguồn gốc] thuộc thể loại [Các thể loại]."
     1. **Ngôn ngữ / Văn phong:** (Đề xuất văn phong thuần Việt mượt mà, trôi chảy, viết rõ: "Tuyệt đối không dùng văn phong convert hay lạm dụng Hán Việt trong miêu tả. Câu cú phải thoát ý thuần Việt. ƯU TIÊN SỐ 1 KHI GẶP ĐIỂN CỐ, ĐIỂN TÍCH, HAY TỪ LÓNG (INTERNET SLANG): Bắt buộc dịch thoát ý linh hoạt, tìm thành ngữ hoặc từ lóng Tiếng Việt tương đương, KHÔNG dịch word-by-word cứng nhắc làm mất cái hay của bản gốc.")
     2. **Tên nhân vật & địa danh:** (Quy tắc dùng Hán Việt, Romaji, hay tên Anh/Gốc...)
     3. **Thuật ngữ đặc trưng:** (Hệ thống, kỹ năng, món ăn, vật phẩm... cần giữ nguyên hay dịch thuần Việt)
     4. **Xưng hô & Ma Trận Xưng Hô:** (Chi tiết cách xưng hô, KHÔNG CHỈ CỦA NHÂN VẬT CHÍNH mà còn giữa các nhân vật phụ với nhau (người thân, kẻ thù, bạn bè, quan hệ chủ tớ, v.v.). Thể hiện sự chuyên nghiệp bằng cách tạo lập ma trận đa chiều, hiểu rõ thái độ, bối cảnh giao tiếp của từng cặp nhân vật. Nếu quan hệ giữa 2 nhân vật có tiến triển rõ rệt trong truyện (vd từ xa lạ sang thân mật/yêu đương), ghi rõ xưng hô đổi khác ra sao theo từng giai đoạn. Nêu luôn quy ước "ngôi kể thứ 3" (cách người kể chuyện gọi nhân vật, vd hắn/nàng hay anh ấy/cô ấy) cho nhất quán xuyên suốt. QUAN TRỌNG: Phải khớp 100% với bối cảnh, phân loại theo 3 NHÓM sau (nếu truyện thuộc thể loại lai/pha trộn nhiều nhóm, ghi rõ xưng hô riêng cho từng phe/nhân vật theo đúng xuất thân của họ, không ép về 1 nhóm chung):
        - NHÓM A (Cổ trang Trung Hoa/Kiếm hiệp/Tiên hiệp, KỂ CẢ Dị giới/Xuyên không nhưng thế giới đến có bản chất kiếm hiệp/tiên hiệp/cổ trang Trung Hoa - tông môn, tu luyện, giang hồ): TUYỆT ĐỐI dùng ta - ngươi, vãn bối - tiền bối, huynh đệ, tỷ muội... CẤM dùng anh - em, tôi - cậu.
        - NHÓM B (Hiện đại/Đô thị/Thập niên 80-90, bối cảnh Trái Đất đời thực): TUYỆT ĐỐI SỬ DỤNG XƯNG HÔ GIA ĐÌNH/XÃ HỘI THEO HIỆN ĐẠI (chú, dì, anh, em, tôi), NGHIÊM CẤM dùng "ta - ngươi" hay xưng hô Hán Việt như "a di", "thúc thúc".
        - NHÓM C (Light Novel Hàn/Nhật/Anh, Fantasy/Dị giới/Học viện phương Tây - KHÔNG phải Trung Hoa cổ trang, KHÔNG phải hiện đại Trái Đất): BẮT BUỘC dùng xưng hô tự nhiên kiểu phương Tây/light novel (tôi/ta - ngài/cô/cậu/anh, tiểu thư, ngài + tước hiệu, huân tước, bệ hạ nếu có hoàng gia). TUYỆT ĐỐI CẤM dùng xưng hô Hán Việt kiểu kiếm hiệp (tiền bối, hậu bối, vãn bối, huynh đệ, tỷ muội) cho nhóm này.)
     5. **Lưu ý bối cảnh:** (Các yếu tố đa thể loại, chuyển đổi ngữ cảnh...)

4. **QUY TẮC XỬ LÝ TÊN TRUYỆN & TÁC GIẢ (BẮT BUỘC):**
   - **TÁC GIẢ:** Tuyệt đối KHÔNG sửa hoặc thay đổi tên tác giả nếu đã có trong văn bản. Giữ nguyên tên gốc.
   - **TÊN TRUYỆN:**
     - Nếu là RAW (Ngoại ngữ): Dịch chuẩn sang tiếng Việt.
     - Nếu là CONVERT (Hán Việt thô): Edit lại cho thuần Việt, mượt mà, văn hay chữ tốt.
     - *Ví dụ:* "Ta Trù Thần, Tông Môn Trên Dưới Bị Thèm Khóc Rồi" = "Ta Là Trù Thần, Toàn Tông Môn Đều Bị Ta Làm Thèm Khóc".

TRẢ VỀ JSON:
{
  "title": "Tên truyện Tiếng Việt (Title Case)",
  "author": "Tác giả (Giữ nguyên)",
  "genres": ["Thể loại 1", "Thể loại 2"],
  "personality": ["Tính cách Main"],
  "setting": ["Bối cảnh"],
  "flow": ["Lưu phái"],
  "language_source": "Tiếng Trung/Convert thô/Tiếng Anh/Tiếng Nhật/Tiếng Hàn",
  "suggested_rules": "Chuỗi văn bản (có xuống dòng \\n) chứa quy tắc dịch thuật gồm 6 phần như yêu cầu ở mục 3.",
  "summary": {
    "context": "Tổng quan & Bối cảnh: Tên truyện, Tác giả, Thể loại, Bối cảnh truyện",
    "main_plot": "Hành trình nhân vật chính: Từ phế nhân đến thiên tài, Đối kháng thế lực, Tình cảm phức tạp",
    "cultivation_system": "Hệ thống tu luyện: Cảnh giới, Hệ thống sức mạnh, Thế giới quan",
    "strengths": "Điểm mạnh của truyện",
    "conclusion": "Nhận xét & Kết luận"
  },
  "image_prompt": "Prompt tiếng Anh để vẽ bìa truyện. Visuals only. NO TEXT. NO TYPOGRAPHY. Detailed art style.",
}

CRITICAL: YOU MUST RETURN VALID JSON. ALL NEWLINES INSIDE STRINGS MUST BE ESCAPED AS \\n. DO NOT USE ACTUAL NEWLINES INSIDE JSON STRING VALUES.
`;


export const GLOSSARY_ANALYSIS_PROMPT = `
*** SYSTEM: SERIES BIBLE ARCHITECT V8.0 - STRUCTURED DICTIONARY ***
⚠️ CRITICAL RULE: THE ENTIRE OUTPUT MUST BE STRICTLY IN VIETNAMESE. DO NOT OUTPUT ENGLISH DESCRIPTIONS OR TRANSLATIONS. TRANSLATE ANY ENGLISH ANALYSIS BACK TO VIETNAMESE.
NHIỆM VỤ: Xây dựng cơ sở dữ liệu "Series Bible" (Từ điển & Ngữ cảnh) CHUYÊN NGHIỆP.

### 🛑 QUY TẮC CẤU TRÚC (STRUCTURE RULES):
Bạn PHẢI phân loại từ vựng vào các NHÓM sau bằng cách sử dụng đúng tiêu đề Header:

# === [1. NHÂN VẬT / CHARACTERS] ===
(Tên người, biệt danh)
[Tên Gốc] = Tên Dịch

# === [2. ĐỊA DANH / LOCATIONS] ===
(Tên đất nước, thành phố, núi sông, bí cảnh)
[Tên Gốc] = Tên Dịch

# === [3. TỔ CHỨC / ORGANIZATIONS] ===
(Tông môn, bang hội, triều đại, công ty)
[Tên Gốc] = Tên Dịch

# === [4. TU LUYỆN & CẢNH GIỚI / CULTIVATION] ===
(Cấp bậc, cảnh giới, hệ thống sức mạnh)
[Tên Gốc] = Tên Dịch

# === [5. VẬT PHẨM & TRANG BỊ / ITEMS] ===
(Vũ khí, đan dược, bảo vật)
[Tên Gốc] = Tên Dịch

# === [6. KỸ NĂNG & CÔNG PHÁP / SKILLS] ===
(Chiêu thức, phép thuật, võ công)
[Tên Gốc] = Tên Dịch

# === [7. XƯNG HÔ & QUAN HỆ / PRONOUNS] ===
NHÂN VẬT & MA TRẬN XƯNG HÔ (CHUYÊN NGHIỆP & ĐA CHIỀU & CÓ DIỄN BIẾN)
- NHIỆM VỤ: Lập ma trận xưng hô chi tiết. KHÔNG CHỈ tập trung vào Nhân vật chính (Main) mà PHẢI bao gồm sinh động cách xưng hô giữa các Nhân vật phụ với nhau (ví dụ: Phụ A gọi Phụ B là gì, biểu hiện thái độ ra sao).
- ĐỊNH DẠNG TỪ ĐIỂN:
**[Tên Gốc/Raw] = Tên Chuẩn || (Vai Trò)**
* *Thân phận:* [Mô tả chi tiết]
* *Tính cách:* [Mô tả tính cách]
* *Ngôi kể thứ 3 (Lời văn tường thuật của người kể chuyện, KHÁC với xưng hô hội thoại giữa các nhân vật bên dưới):* [hắn/nàng/gã/ả/y/thị cho Nhóm A; anh ấy/cô ấy/cậu ấy/chị ấy cho Nhóm B; anh ta/cô ta/chàng/nàng tuỳ ngữ cảnh cho Nhóm C — chọn ĐÚNG 1 cách và dùng NHẤT QUÁN xuyên suốt mỗi khi người kể chuyện (không phải nhân vật khác) nhắc tới nhân vật này]
* *Xưng hô (CÓ THỂ THAY ĐỔI THEO DIỄN BIẾN QUAN HỆ — bắt buộc theo dõi nếu phát hiện có sự thay đổi):*
    * Với [Nhân vật A]:
        - Giai đoạn đầu (mới gặp/xa lạ/chưa thân): **[Xưng] - [Hô]** (Thái độ/Bối cảnh: khách sáo/dè dặt/thù địch...)
        - Giai đoạn sau (SAU KHI quan hệ thay đổi rõ rệt trong truyện — thân thiết hơn/thành người yêu-vợ chồng/kết nghĩa/trở mặt thành thù...): **[Xưng] - [Hô]** (Thái độ/Bối cảnh: thân mật/âu yếm/căm ghét..., ghi rõ mốc chuyển biến nếu xác định được, ví dụ "từ sau khi hai người xác nhận tình cảm" hoặc "từ chương X trở đi")
        (CHỈ chia giai đoạn khi có bằng chứng THỰC SỰ trong văn bản cho thấy cách xưng hô đổi khác đi theo thời gian/biến cố; nếu xưng hô không đổi suốt truyện, chỉ ghi 1 dòng duy nhất, KHÔNG bịa ra sự thay đổi không có thật.)
    * Với [Nhân vật B]: (tương tự)
(Đặc biệt quan trọng: Ai gọi ai là gì? CHÚ Ý: Xưng hô PHẢI đúng bối cảnh, phân loại theo 3 NHÓM sau:
    - NHÓM A (Cổ trang Trung Hoa/Kiếm hiệp/Tiên hiệp, KỂ CẢ Dị giới/Xuyên không nhưng thế giới đến có bản chất kiếm hiệp/tiên hiệp/cổ trang Trung Hoa - tông môn, tu luyện, giang hồ): Phải dùng ta-ngươi, huynh-đệ, tỷ-muội, vãn bối-tiền bối... CẤM DÙNG anh-em, tôi-cậu.
    - NHÓM B (Hiện đại/Đô thị/Thập niên 80-90, bối cảnh Trái Đất đời thực): TUYỆT ĐỐI SỬ DỤNG XƯNG HÔ GIA ĐÌNH/XÃ HỘI THEO HIỆN ĐẠI (chú, dì, anh, em, tôi), KHÔNG dùng "ta - ngươi" hay Hán Việt như "a di", "thúc thúc".
    - NHÓM C (Light Novel Hàn/Nhật/Anh, Fantasy/Dị giới/Học viện phương Tây - KHÔNG phải Trung Hoa cổ trang, KHÔNG phải hiện đại Trái Đất): BẮT BUỘC dùng xưng hô tự nhiên kiểu phương Tây/light novel (tôi/ta - ngài/cô/cậu/anh, tiểu thư, ngài + tước hiệu, huân tước, bệ hạ nếu có hoàng gia), TUYỆT ĐỐI CẤM dùng xưng hô Hán Việt kiểu kiếm hiệp (tiền bối, hậu bối, vãn bối, huynh đệ, tỷ muội) cho nhóm này.
    - THỂ LOẠI LAI (HYBRID - khi truyện pha trộn nhiều nhóm, vd nhân vật hiện đại xuyên không vào thế giới cổ trang, hoặc học viện phương Tây có yếu tố tu luyện Trung Hoa): KHÔNG được ép cứng về 1 nhóm duy nhất cho toàn bộ nhân vật. Xác định xưng hô theo ĐÚNG XUẤT THÂN/BỐI CẢNH GIAO TIẾP TẠI THỜI ĐIỂM của TỪNG nhân vật — ví dụ nhân vật xuyên không từ hiện đại có thể vẫn giữ "tôi" để thể hiện xuất thân khác biệt, trong khi người bản địa cổ trang gọi họ theo kiểu "ngươi/các hạ". Khi 2 nhân vật đến từ 2 nhóm khác nhau nói chuyện, ghi rõ CÁCH XƯNG HÔ CỦA TỪNG BÊN riêng (không phải 1 cặp chung), và giải thích ngắn gọn lý do trong phần Thái độ/Bối cảnh để người dịch hiểu đây là chủ đích chứ không phải lỗi không nhất quán.
    - THỂ LOẠI NGÔN TÌNH/ROMANCE: đặc biệt chú trọng theo dõi CHÍNH XÁC giai đoạn chuyển xưng hô khi tình cảm 2 nhân vật tiến triển (từ xa lạ/đồng nghiệp/bạn bè -> người yêu/vợ chồng), vì đây thường là chi tiết tinh tế quan trọng nhất thể hiện diễn biến tình cảm mà bản dịch PHẢI bắt đúng, sai giai đoạn xưng hô ở thể loại này gây phản cảm rõ rệt cho người đọc.)
[Tên Gốc] = Tên Dịch


### 🛑 QUY TẮC CỐT LÕI (BẮT BUỘC TUÂN THỦ 100%):
**VẾ TRÁI (KEY) PHẢI LÀ TỪ CÓ THỰC TRONG VĂN BẢN ĐẦU VÀO.**

*** CƠ CHẾ CHỐNG DỊCH NGƯỢC (ANTI-TRANSLATION MECHANISM) ***
1. **AI phải hoạt động như một máy photocopy đối với VẾ TRÁI.**
2. **Tìm từ trong văn bản = Copy y nguyên vào Vế Trái = Dịch sang Vế Phải.**
3. **TUYỆT ĐỐI KHÔNG DỊCH VẾ TRÁI.**
   - Nếu văn bản là tiếng Trung, vế trái phải là chữ Hán.
   - Nếu văn bản là tiếng Anh, vế trái phải là tiếng Anh.
   - Nếu văn bản là tiếng Việt (Convert), vế trái phải là từ trong văn bản (kể cả sai chính tả).
4. **Nếu Vế Trái không tìm thấy trong văn bản gốc = HALLUCINATION (Ảo giác) = Cấm xuất ra.**

1. **NẾU VĂN BẢN LÀ RAW (Trung/Anh/Nhật/Hàn):**
   - Vế Trái = **KÝ TỰ GỐC (COPY-PASTE)**
   - Vế Phải = **Hán Việt / Dịch Nghĩa Tiếng Việt**
   - *Ví dụ ĐÚNG:* [萧炎] = Tiêu Viêm
   - *Ví dụ SAI:* [Tiêu Viêm] = Tiêu Viêm (Sai, vì văn bản gốc là chữ Hán!)

2. **NẾU VĂN BẢN LÀ CONVERT/DỊCH THÔ (Tiếng Việt):**
   - Vế Trái = **TỪ GỐC TRONG VĂN BẢN (Dù sai chính tả, viết thường, từ cũ)**
   - Vế Phải = **Tên Chuẩn Hóa (Viết hoa, đúng ngữ pháp)**
   - *Ví dụ ĐÚNG:* [tiểu viêm tử] = Tiêu Viêm Tử
   - *Ví dụ ĐÚNG:* [lâm lôi] = Lâm Lôi
   - *Ví dụ SAI:* [Lâm Lôi] = Lin Lei (CẤM DỊCH NGƯỢC SANG PINYIN/ANH)

### 🛑 QUY TẮC NÂNG CẤP VỚI NGUYÊN TẮC "PHỤC HỒI NGUYÊN TÁC" & "GIỮ TÊN GỐC" (ƯU TIÊN TỐI THƯỢNG - ÁP DỤNG CHO TẤT CẢ CÁC PHẦN):
   - **Phạm vi áp dụng:** Đồng nhân Anime/Manga/Game (Honkai Impact, Star Rail, Genshin, Naruto, One Piece...), Light Novel, Sci-fi, Game Âu Mỹ (LoL, Dota, WoW), Bối cảnh Phương Tây (Harry Potter, Marvel).
   - **Quy tắc:** BẮT BUỘC trả về tên gốc Tiếng Anh (hoặc Romaji chuẩn) cho: Tên Nhân Vật, Tên Kỹ Năng (Skill), Vật Phẩm (Item), Tổ Chức trong vế phải nếu phù hợp.
   - **TUYỆT ĐỐI KHÔNG DỊCH HÁN VIỆT** trong các bối cảnh này. Ưu tiên phục hồi nguyên tác bằng cách giữ tên gốc nếu mâu thuẫn với dịch nghĩa.
   - *Ví dụ Honkai/Sci-fi:* [Judgement of Shamash] = Judgement of Shamash (Sai: Thiên Hỏa Thánh Phán); [Herrscher] = Herrscher; [Kiana] = Kiana (Sai: Kỳ Á Na).
   - *Ví dụ Harry Potter/Western:* [哈利] = Harry; [哥布林] = Goblin; [亚瑟] = Arthur.

### 🛑 QUY TẮC NÂNG CẤP "VẤN" (BẤT DI BẤT DỊCH):
   - Gặp chữ "Vấn" (问) trong tên riêng/chiêu thức = Giữ nguyên là "Vấn" trong vế phải.
   - *Ví dụ:* [问道宗] = Vấn Đạo Tông (Sai: Hỏi Đạo Tông); [莫问] = Mạc Vấn.

### 🛑 QUY TẮC CẤM TRỘN TIẾNG ANH VÀO TIẾNG VIỆT (BẤT DI BẤT DỊCH):
   - TRONG TOÀN BỘ BẢN BÁO CÁO PHÂN TÍCH, TUYỆT ĐỐI CẤM sử dụng các từ liên kết tiếng Anh xen kẽ vào câu tiếng Việt (ví dụ: CẤM "But", "And", "On", "The", "In"). Mọi diễn đạt, miêu tả BẮT BUỘC phải là tiếng Việt 100% thuần túy.

### 🛑 QUY TẮC NÂNG CẤP CHUẨN HÓA TÊN NHÂN VẬT (THEO NGUỒN GỐC THỰC SỰ CỦA TÁC PHẨM):
   - **Dù văn bản gốc là ngôn ngữ gì, phải chuẩn hóa tên theo nguồn gốc thực sự của tác phẩm.**
   - **Trung Quốc (Cổ trang/Tiên hiệp/Đô thị):** Dùng 100% Hán Việt chuẩn trong vế phải. *Ví dụ:* [叶凡] = Diệp Phàm, [凌青姝] = Lăng Thanh Thù (TUYỆT ĐỐI KHÔNG để sót Ký Tự Hán ở VẾ PHẢI - Không được ghi Lăng Thanh姝).
   - **Nhật Bản (Light Novel/Anime):** Romaji chuẩn Hepburn. *Ví dụ:* [桐ヶ谷] hoặc [Đồng Cốc] = Kirigaya. Tên Tây trong tiếng Nhật = Tiếng Anh ([アリス] = Alice). Giữ nguyên hậu tố -san, -kun.
   - **Hàn Quốc (Manhwa/Light Novel):** Romanized chuẩn. *Ví dụ:* [김독자] hoặc [Kim Độc Giả] = Kim Dok-ja.
   - **Phương Tây/Fantasy:** Giữ nguyên tên tiếng Anh. *Ví dụ:* [哈利] hoặc [Cáp Lợi] = Harry.

### 🛑 QUY TẮC NÂNG CẤP XỬ LÝ DANH HIỆU & CHỨC VỊ:
   - **Dr.:** Bối cảnh đời thường = Bác sĩ. Bối cảnh Khoa học/SCP = Tiến sĩ.

### 🛑 QUY TẮC NÂNG CẤP TỔ CHỨC / TÔNG MÔN / GUILD:
   - **Cổ trang:** Hán Việt (Tạc Thiên Bang).
   - **Võng du/Hiện đại/Sci-fi:** 
     - Tên Tiếng Anh/Latin (Wolf Guild, Anti-Entropy, Schicksal) = GIỮ NGUYÊN Tiếng Anh.
     - [SHIELD] = S.H.I.E.L.D.

### 🛑 QUY TẮC NÂNG CẤP KỸ NĂNG / ITEM / LEVEL (PHÂN LOẠI THEO THỂ LOẠI):
   - **Tiên hiệp/Kiếm hiệp/Huyền huyễn phương Đông (Truyện Trung):** Dịch Hán Việt hoa mỹ, giữ nguyên Hán Việt cho cấp bậc, cảnh giới.
     - *Ví dụ:* Đấu khí tam đoạn, Thất tinh đấu tôn, Trưởng lão tam tinh, Phật Nộ Hỏa Liên, Tru Tiên Kiếm.
   - **Game/System/Sci-fi/Anime/Western:**
     - **BẮT BUỘC GIỮ TIẾNG ANH** cho tên Skill/Ulti/Item/Vũ khí.
     - *Ví dụ:* [Excalibur] = Excalibur; [Railgun] = Railgun; [Fireball] = Fireball.
     - Level: [Lv.10] hoặc [Cấp 10].
     - Class: Giữ tiếng Anh nếu phổ biến (Necromancer, Paladin, Valkyrie).

### 🛑 QUY TẮC CHUẨN HÓA SỐ LIỆU & NGÀY THÁNG & TỪ VAY MƯỢN:
   - **Số liệu:** Nếu bản gốc dùng số Ả Rập (VD: 17, 73), tuyệt đối giữ nguyên là số. Nếu bản gốc dùng chữ, dịch trôi chảy theo văn xuôi, không ép đổi sang số nếu làm gãy câu. Phải kết hợp chữ và số cho mệnh giá cực lớn (10 vạn, 1 triệu).
   - **CRITICAL:** Khi dịch các bảng thông số, chỉ số có nhiều chữ số 0 (ví dụ: 10000000, 500000), BẮT BUỘC phải chuyển đổi sang dạng chữ viết tắt (ví dụ: 10 triệu, 50 vạn). TUYỆT ĐỐI KHÔNG in ra một dải dài các số 0 liên tiếp để tránh lỗi lặp ký tự.
   - **BẢO VỆ SỐ TRONG DANH TỪ RIÊNG/THÀNH NGỮ:** Chữ số Hán Việt (vạn, thiên, ức, bách, thập...) khi là một phần cố định của địa danh, tên riêng, tên môn phái/chiêu thức hoặc thành ngữ Hán Việt (KHÔNG PHẢI số liệu/số lượng thực tế) TUYỆT ĐỐI KHÔNG được đổi sang số Ả Rập. VÍ DỤ CẤM: "Thập Vạn Đại Sơn" (địa danh) không được dịch thành "Thập 10000 Đại Sơn" hay "10 Vạn Đại Sơn" — PHẢI giữ nguyên "Thập Vạn Đại Sơn". Tương tự giữ nguyên Hán Việt cho "vạn cổ", "cửu vạn lý", "bách vạn hùng binh", "thiên quân vạn mã".
   - **Ngày tháng:** Giữ nguyên dạng số hoặc chữ của bản gốc, miễn là tự nhiên.
   - **Từ vay mượn:** Giữ nguyên (WiFi, AI, Google, smartphone, km, kg...). Cấm phiên âm Hán Việt.

### 🛑 QUY TẮC NÂNG CẤP CHỦNG TỘC (RACE):
   - Elf = Elf; Dwarf = Dwarf; Goblin = Goblin; Orc = Orc.
   - Honkai/Star Rail: Aeon = Aeon; Archon = Archon.


### CẤU TRÚC ĐẦU RA BẮT BUỘC:

**# 1. THÔNG TIN CƠ BẢN**
- Tóm tắt thế giới quan, cấp độ tu luyện.

**# 2. PHÂN LOẠI TỪ ĐIỂN (GLOSSARY)**
(Liệt kê theo các nhóm đã định nghĩa ở trên: NHÂN VẬT, ĐỊA DANH...)

**# 3. NGỮ CẢNH & SỰ KIỆN QUAN TRỌNG**
- Các sự kiện lớn.

**# 4. TIẾN TRÌNH CỐT TRUYỆN TÍCH LŨY**
- Tóm tắt dòng thời gian.

**# 5. GHI CHÚ DỊCH THUẬT**
- Lưu ý văn phong.
`;

export const NAME_ANALYSIS_PROMPT = `
⚠️ CRITICAL RULE: THE ENTIRE OUTPUT MUST BE STRICTLY IN VIETNAMESE. DO NOT OUTPUT ENGLISH DESCRIPTIONS OR TRANSLATIONS. TRANSLATE ANY ENGLISH ANALYSIS BACK TO VIETNAMESE.
NHIỆM VỤ: Trích xuất danh sách Tên Riêng và phân loại chúng vào các nhóm chuyên biệt.

### CẤU TRÚC TRẢ VỀ (BẮT BUỘC):

# === [1. NHÂN VẬT / CHARACTERS] ===
[Tên Gốc] = Tên Dịch

# === [2. ĐỊA DANH / LOCATIONS] ===
[Tên Gốc] = Tên Dịch

# === [3. TỔ CHỨC / ORGANIZATIONS] ===
[Tên Gốc] = Tên Dịch

# === [4. VẬT PHẨM & KỸ NĂNG / ITEMS & SKILLS] ===
[Tên Gốc] = Tên Dịch


### 🛑 QUY TẮC CỐT LÕI (BẮT BUỘC):
**VẾ TRÁI PHẢI LÀ TỪ CÓ THỰC TRONG VĂN BẢN ĐẦU VÀO.**

1. **NẾU INPUT LÀ RAW (Trung/Anh):** Trả về **[Tên Gốc] = [Tên Dịch]**
   - VD: [Fireball] = Cầu Lửa.
   - VD: [夜未明] = Dạ Vị Minh.

2. **NẾU INPUT LÀ CONVERT (Tiếng Việt):** Trả về **[Tên Trong Văn Bản] = [Tên Viết Hoa Chuẩn]**
   - **TUYỆT ĐỐI KHÔNG** bịa ra Pinyin hay tiếng Anh.
   - VD SAI: [Tiểu Hắc] = Xiao Hei.
   - VD ĐÚNG: [tiểu hắc] = Tiểu Hắc.
   - VD ĐÚNG: [bộ phương] = Bộ Phương.

### 🛑 QUY TẮC NÂNG CẤP VỚI NGUYÊN TẮC "PHỤC HỒI NGUYÊN TÁC" & "GIỮ TÊN GỐC" (ƯU TIÊN TỐI THƯỢNG):
   - **Phạm vi áp dụng:** Đồng nhân Anime/Manga/Game (Honkai Impact, Star Rail, Genshin, Naruto, One Piece...), Light Novel, Sci-fi, Game Âu Mỹ (LoL, Dota, WoW), Bối cảnh Phương Tây (Harry Potter, Marvel).
   - **Quy tắc:** BẮT BUỘC trả về tên gốc Tiếng Anh (hoặc Romaji chuẩn) cho: Tên Nhân Vật, Tên Kỹ Năng (Skill), Vật Phẩm (Item), Tổ Chức trong vế phải nếu phù hợp.
   - **TUYỆT ĐỐI KHÔNG DỊCH HÁN VIỆT** trong các bối cảnh này. Ưu tiên phục hồi nguyên tác bằng cách giữ tên gốc nếu mâu thuẫn với dịch nghĩa.
   - *Ví dụ Honkai/Sci-fi:* [Judgement of Shamash] = Judgement of Shamash (Sai: Thiên Hỏa Thánh Phán); [Herrscher] = Herrscher; [Kiana] = Kiana (Sai: Kỳ Á Na).
   - *Ví dụ Harry Potter/Western:* [哈利] = Harry; [哥布林] = Goblin; [亚瑟] = Arthur.

### 🛑 QUY TẮC NÂNG CẤP "VẤN" (BẤT DI BẤT DỊCH):
   - Gặp chữ "Vấn" (问) trong tên riêng/chiêu thức = Giữ nguyên là "Vấn" trong vế phải.
   - *Ví dụ:* [问道宗] = Vấn Đạo Tông (Sai: Hỏi Đạo Tông); [莫问] = Mạc Vấn.

### 🛑 QUY TẮC CẤM TRỘN TIẾNG ANH VÀO TIẾNG VIỆT (BẤT DI BẤT DỊCH):
   - TRONG TOÀN BỘ BẢN BÁO CÁO PHÂN TÍCH, TUYỆT ĐỐI CẤM sử dụng các từ liên kết tiếng Anh xen kẽ vào câu tiếng Việt (ví dụ: CẤM "But", "And", "On", "The", "In"). Mọi diễn đạt, miêu tả BẮT BUỘC phải là tiếng Việt 100% thuần túy.

### 🛑 QUY TẮC NÂNG CẤP CHUẨN HÓA TÊN NHÂN VẬT (THEO NGUỒN GỐC THỰC SỰ CỦA TÁC PHẨM):
   - **Dù văn bản gốc là ngôn ngữ gì, phải chuẩn hóa tên theo nguồn gốc thực sự của tác phẩm.**
   - **Trung Quốc (Cổ trang/Tiên hiệp/Đô thị):** Dùng 100% Hán Việt chuẩn trong vế phải. *Ví dụ:* [叶凡] = Diệp Phàm, [凌青姝] = Lăng Thanh Thù (TUYỆT ĐỐI KHÔNG để sót Ký Tự Hán ở VẾ PHẢI - Không được ghi Lăng Thanh姝).
   - **Nhật Bản (Light Novel/Anime):** Romaji chuẩn Hepburn. *Ví dụ:* [桐ヶ谷] hoặc [Đồng Cốc] = Kirigaya. Tên Tây trong tiếng Nhật = Tiếng Anh ([アリス] = Alice). Giữ nguyên hậu tố -san, -kun.
   - **Hàn Quốc (Manhwa/Light Novel):** Romanized chuẩn. *Ví dụ:* [김독자] hoặc [Kim Độc Giả] = Kim Dok-ja.
   - **Phương Tây/Fantasy:** Giữ nguyên tên tiếng Anh. *Ví dụ:* [哈利] hoặc [Cáp Lợi] = Harry.

### 🛑 QUY TẮC NÂNG CẤP XỬ LÝ DANH HIỆU & CHỨC VỊ:
   - **Dr.:** Bối cảnh đời thường = Bác sĩ. Bối cảnh Khoa học/SCP = Tiến sĩ.

### 🛑 QUY TẮC NÂNG CẤP TỔ CHỨC / TÔNG MÔN / GUILD:
   - **Cổ trang:** Hán Việt (Tạc Thiên Bang).
   - **Võng du/Hiện đại/Sci-fi:** 
     - Tên Tiếng Anh/Latin (Wolf Guild, Anti-Entropy, Schicksal) = GIỮ NGUYÊN Tiếng Anh.
     - [SHIELD] = S.H.I.E.L.D.

### 🛑 QUY TẮC NÂNG CẤP KỸ NĂNG / ITEM / LEVEL (PHÂN LOẠI THEO THỂ LOẠI):
   - **Tiên hiệp/Kiếm hiệp/Huyền huyễn phương Đông (Truyện Trung):** Dịch Hán Việt hoa mỹ, giữ nguyên Hán Việt cho cấp bậc, cảnh giới.
     - *Ví dụ:* Đấu khí tam đoạn, Thất tinh đấu tôn, Trưởng lão tam tinh, Phật Nộ Hỏa Liên, Tru Tiên Kiếm.
   - **Game/System/Sci-fi/Anime/Western:**
     - **BẮT BUỘC GIỮ TIẾNG ANH** cho tên Skill/Ulti/Item/Vũ khí.
     - *Ví dụ:* [Excalibur] = Excalibur; [Railgun] = Railgun; [Fireball] = Fireball.
     - Level: [Lv.10] hoặc [Cấp 10].
     - Class: Giữ tiếng Anh nếu phổ biến (Necromancer, Paladin, Valkyrie).

### 🛑 QUY TẮC CHUẨN HÓA SỐ LIỆU & NGÀY THÁNG & TỪ VAY MƯỢN:
   - **Số liệu:** Nếu bản gốc dùng số Ả Rập (VD: 17, 73), tuyệt đối giữ nguyên là số. Nếu bản gốc dùng chữ, dịch trôi chảy theo văn xuôi, không ép đổi sang số nếu làm gãy câu. Phải kết hợp chữ và số cho mệnh giá cực lớn (10 vạn, 1 triệu).
   - **CRITICAL:** Khi dịch các bảng thông số, chỉ số có nhiều chữ số 0 (ví dụ: 10000000, 500000), BẮT BUỘC phải chuyển đổi sang dạng chữ viết tắt (ví dụ: 10 triệu, 50 vạn). TUYỆT ĐỐI KHÔNG in ra một dải dài các số 0 liên tiếp để tránh lỗi lặp ký tự.
   - **BẢO VỆ SỐ TRONG DANH TỪ RIÊNG/THÀNH NGỮ:** Chữ số Hán Việt (vạn, thiên, ức, bách, thập...) khi là một phần cố định của địa danh, tên riêng, tên môn phái/chiêu thức hoặc thành ngữ Hán Việt (KHÔNG PHẢI số liệu/số lượng thực tế) TUYỆT ĐỐI KHÔNG được đổi sang số Ả Rập. VÍ DỤ CẤM: "Thập Vạn Đại Sơn" (địa danh) không được dịch thành "Thập 10000 Đại Sơn" hay "10 Vạn Đại Sơn" — PHẢI giữ nguyên "Thập Vạn Đại Sơn". Tương tự giữ nguyên Hán Việt cho "vạn cổ", "cửu vạn lý", "bách vạn hùng binh", "thiên quân vạn mã".
   - **Ngày tháng:** Giữ nguyên dạng số hoặc chữ của bản gốc, miễn là tự nhiên.
   - **Từ vay mượn:** Giữ nguyên (WiFi, AI, Google, smartphone, km, kg...). Cấm phiên âm Hán Việt.

### 🛑 QUY TẮC NÂNG CẤP CHỦNG TỘC (RACE):
   - Elf = Elf; Dwarf = Dwarf; Goblin = Goblin; Orc = Orc.
   - Honkai/Star Rail: Aeon = Aeon; Archon = Archon.


`;

// Tùy chọn xưng hô của người dùng cho tính năng "Phân Tích Sâu" (deep_context). Khi khác
// 'flexible', instruction này được chèn (với độ ưu tiên cao nhất) vào các bước phân tích/hợp
// nhất/tinh chỉnh quy tắc, GHI ĐÈ lên hệ thống phân loại 3 NHÓM (A/B/C) mặc định trong
// GLOSSARY_ANALYSIS_PROMPT/MERGE_CONTEXT_PROMPT/refineAdditionalRules — vì người dùng đã chủ
// động chọn 1 kiểu xưng hô duy nhất cho toàn truyện, bất kể bối cảnh từng nhân vật.
export function getPronounModeOverride(mode?: 'modern' | 'ancient' | 'flexible'): string {
    if (!mode || mode === 'flexible') return '';

    const MODERN_ALLOWED = 'anh, em, cha, mẹ, cô, dì, chú, bác, ông, bà, tôi, cậu, chị, con, bạn (và các biến thể xã hội/gia đình hiện đại thuần Việt tương đương)';
    const MODERN_FORBIDDEN = 'huynh, muội, đệ, phụ thân, nương, mẫu thân, a di, thúc thúc, đại bá, đại nương, gia gia, nãi nãi, ta, ngươi, tại hạ, các hạ, tiền bối, hậu bối, vãn bối, huynh đài, tỷ tỷ, ca ca (và mọi xưng hô cổ trang/Hán Việt khác)';
    const ANCIENT_ALLOWED = 'huynh, muội, đệ, phụ thân, nương, mẫu thân, a di, thúc thúc, đại bá, đại nương, gia gia, nãi nãi, ta, ngươi, tiền bối, hậu bối, vãn bối (và các biến thể xưng hô cổ trang/Hán Việt tương đương)';
    const ANCIENT_FORBIDDEN = 'anh, em, cha, mẹ, cô, dì, chú, bác, ông, bà, tôi, cậu (và mọi xưng hô gia đình/xã hội hiện đại thuần Việt khác)';

    const label = mode === 'modern' ? 'HIỆN ĐẠI' : 'CỔ ĐẠI';
    const allowed = mode === 'modern' ? MODERN_ALLOWED : ANCIENT_ALLOWED;
    const forbidden = mode === 'modern' ? MODERN_FORBIDDEN : ANCIENT_FORBIDDEN;

    return `### 🛑 GHI ĐÈ TUYỆT ĐỐI VỀ XƯNG HÔ (TÙY CHỌN NGƯỜI DÙNG: "${label}") — ƯU TIÊN TỐI THƯỢNG, GHI ĐÈ LÊN TOÀN BỘ HỆ THỐNG PHÂN LOẠI 3 NHÓM (A/B/C) Ở TRÊN:
Người dùng đã CHỦ ĐỘNG chọn chế độ xưng hô "${label}" cho TOÀN BỘ truyện. Áp dụng ĐỒNG NHẤT cho MỌI nhân vật, MỌI mối quan hệ (gia đình lẫn xã hội), bất kể bối cảnh truyện là cổ trang/tiên hiệp/dị giới/phương Tây hay hiện đại — KHÔNG phân biệt NHÓM A/B/C nữa.
- CHỈ ĐƯỢC dùng: ${allowed}.
- TUYỆT ĐỐI CẤM dùng dưới mọi hình thức, kể cả khi bối cảnh gốc có vẻ phù hợp hơn với nhóm còn lại: ${forbidden}.
- Áp dụng cho cả Ma Trận Xưng Hô (mục Xưng hô/PRONOUNS) lẫn phần "Quy Tắc Bổ Sung" liên quan tới cách gọi giữa các nhân vật. KHÔNG áp dụng cho tên riêng/thuật ngữ/chức danh không phải xưng hô trực tiếp giữa người với người.`;
}

// Tùy chọn CHUẨN HÓA ĐƠN VỊ SỐ ĐẾM (vạn/ức Hán Việt cổ vs nghìn/triệu/tỷ hiện đại) của người
// dùng cho tính năng "Phân Tích Sâu" (deep_context) — cùng cơ chế với getPronounModeOverride ở
// trên. Khi khác 'flexible', instruction này được chèn với độ ưu tiên cao nhất vào các bước
// phân tích/hợp nhất/tinh chỉnh quy tắc, buộc AI dùng ĐÚNG 1 hệ đơn vị số cho toàn truyện thay
// vì trộn lẫn "vạn/ức" (hệ Hán Việt cổ, x10^4/x10^8) với "triệu/tỷ" (hệ thập phân phương Tây) —
// áp dụng cho cả lời văn lẫn bảng thông số/hệ thống (status panel).
export function getNumberUnitModeOverride(mode?: 'modern' | 'ancient' | 'flexible'): string {
    if (!mode || mode === 'flexible') return '';

    const ANCIENT_ALLOWED = 'chục, trăm, nghìn/ngàn, vạn (= 10 nghìn), ức (= 100 triệu), và các bội số Hán Việt cổ ghép từ chúng (thập vạn, bách vạn, thiên vạn, ức vạn...)';
    const ANCIENT_FORBIDDEN = '"triệu", "tỷ/tỉ" kiểu phương Tây khi dùng để đếm số lượng/quy mô lớn (vẫn được dùng bình thường cho đơn vị đo lường hiện đại rõ ràng như km, kg, °C nếu bản gốc có)';
    const MODERN_ALLOWED = 'chục, trăm, nghìn/ngàn, triệu, tỷ/tỉ theo hệ thập phân quốc tế (1 triệu = 1.000.000, 1 tỷ = 1.000.000.000)';
    const MODERN_FORBIDDEN = '"vạn", "ức" kiểu Hán Việt cổ — BẮT BUỘC quy đổi sang nghìn/triệu/tỷ tương ứng (VD: "10 vạn" -> "100 nghìn"; "3 ức" -> "300 triệu")';

    const label = mode === 'modern' ? 'HIỆN ĐẠI' : 'CỔ ĐẠI';
    const allowed = mode === 'modern' ? MODERN_ALLOWED : ANCIENT_ALLOWED;
    const forbidden = mode === 'modern' ? MODERN_FORBIDDEN : ANCIENT_FORBIDDEN;

    return `### 🛑 GHI ĐÈ TUYỆT ĐỐI VỀ ĐƠN VỊ SỐ ĐẾM (TÙY CHỌN NGƯỜI DÙNG: "${label}") — ƯU TIÊN TỐI THƯỢNG:
Người dùng đã CHỦ ĐỘNG chọn hệ đơn vị số đếm "${label}" cho TOÀN BỘ truyện. Áp dụng ĐỒNG NHẤT cho MỌI con số lớn xuất hiện trong lời văn/tường thuật LẪN trong bảng thông số/hệ thống (status panel, chỉ số nhân vật, phần thưởng...), không phân biệt ngữ cảnh.
- CHỈ ĐƯỢC dùng: ${allowed}.
- TUYỆT ĐỐI CẤM trộn lẫn với: ${forbidden}.
- KHÔNG được đổi hệ đơn vị giữa chương này với chương khác, hay giữa lời văn với bảng thông số trong cùng 1 chương — phải nhất quán xuyên suốt cả truyện.
- KHÔNG áp dụng cho số đếm là một phần cố định của địa danh/tên riêng/thành ngữ Hán Việt (VD: "Thập Vạn Đại Sơn", "vạn cổ", "cửu vạn lý") — các cụm này giữ nguyên bất kể chế độ đang chọn.`;
}

export const MERGE_GLOSSARY_PROMPT = `⚠️ CRITICAL RULE: THE ENTIRE OUTPUT MUST BE STRICTLY IN VIETNAMESE. DO NOT OUTPUT ENGLISH DESCRIPTIONS OR TRANSLATIONS. TRANSLATE ANY ENGLISH ANALYSIS BACK TO VIETNAMESE.
Hợp nhất từ điển. Loại bỏ trùng lặp. Sắp xếp từ vựng vào đúng các nhóm phân loại (NHÂN VẬT, ĐỊA DANH, TỔ CHỨC, VẬT PHẨM...). Ưu tiên thuật ngữ Tiếng Anh cho bối cảnh Game/Sci-fi và Hán Việt cho bối cảnh Cổ trang.`

export const MERGE_CONTEXT_PROMPT = `
*** SYSTEM: DATABASE MERGER V3.6 - ACCUMULATIVE & RAW-SAFE & PRONOUN MATRIX ***
⚠️ CRITICAL RULE: THE ENTIRE OUTPUT MUST BE STRICTLY IN VIETNAMESE. DO NOT OUTPUT ENGLISH DESCRIPTIONS OR TRANSLATIONS. TRANSLATE ANY ENGLISH ANALYSIS BACK TO VIETNAMESE.
NHIỆM VỤ: Hợp nhất các bản phân tích rời rạc thành một "Series Bible" hoàn chỉnh duy nhất.

### 🛑 QUY TẮC HỢP NHẤT:
1. **PHÂN LOẠI TỪ ĐIỂN:** Gom tất cả từ vựng từ các phần vào đúng các nhóm:
   - # === [1. NHÂN VẬT / CHARACTERS] ===
   - # === [2. ĐỊA DANH / LOCATIONS] ===
   - # === [3. TỔ CHỨC / ORGANIZATIONS] ===
   - # === [4. TU LUYỆN / CULTIVATION] ===
   - # === [5. VẬT PHẨM / ITEMS] ===
   - # === [7. XƯNG HÔ & QUAN HỆ / PRONOUNS] ===
2. **CHẾ ĐỘ TÍCH LŨY (BẮT BUỘC):** 
   - Hợp nhất từ điển theo phương pháp cộng dồn (Additive Merging). 
   - Tuyệt đối không xóa bỏ hay thay thế từ vựng đã tồn tại.
   - Nếu bản A có nhân vật X, bản B có nhân vật Y = Kết quả phải có cả X và Y.
   - Nếu trùng lặp Key (Vế trái), chỉ giữ lại bản ghi chi tiết hơn hoặc bản ghi đầu tiên, tuyệt đối không được tự ý dịch thay thế.
3. **BẢO TOÀN KEY GỐC:** Nếu Key là chữ Hán, giữ nguyên chữ Hán.
4. **HỢP NHẤT MA TRẬN XƯNG HÔ (QUAN TRỌNG):**
   - Tìm mục # === [7. XƯNG HÔ & QUAN HỆ / PRONOUNS] ===.
   - Nếu cùng một nhân vật xuất hiện ở nhiều bản, hãy GỘP thông tin xưng hô lại thành một khối duy nhất cho nhân vật đó.
   - **BẢO TOÀN "NGÔI KỂ THỨ 3" VÀ CÁC GIAI ĐOẠN XƯNG HÔ:** Nếu các bản nguồn có ghi "Ngôi kể thứ 3" hoặc chia nhiều "Giai đoạn" xưng hô (vd Giai đoạn đầu/Giai đoạn sau) cho cùng 1 cặp nhân vật, BẮT BUỘC giữ nguyên toàn bộ các giai đoạn đó theo đúng THỨ TỰ THỜI GIAN xuất hiện trong truyện (không được chỉ giữ 1 giai đoạn rồi bỏ giai đoạn còn lại) — vì đây chính là diễn biến thay đổi quan hệ theo thời gian, mất đi sẽ khiến bản dịch xưng hô sai lệch giữa các chương trước/sau khi hợp nhất.
   - **BẮT BUỘC GIỮ ĐỊNH DẠNG MA TRẬN:**
     **[Tên Gốc] = Tên Chuẩn || (Vai Trò)**
     * *Thân phận:* ...
     * *Tính cách:* ...
     * *Ngôi kể thứ 3:* [Giữ nguyên nếu bản nguồn có ghi, không tự ý đổi]
     * *Xưng hô:*
         * Với [Nhân vật A]:
             - Giai đoạn đầu: **[Xưng] - [Hô]**
             - Giai đoạn sau (nếu có): **[Xưng] - [Hô]**
         (LƯU Ý: Xưng hô khi gộp lại PHẢI phù hợp bối cảnh, phân loại theo 3 NHÓM:
         - NHÓM A (Cổ trang Trung Hoa/Kiếm hiệp/Tiên hiệp, KỂ CẢ Dị giới/Xuyên không nhưng thế giới đến có bản chất kiếm hiệp/tiên hiệp/cổ trang Trung Hoa): BẮT BUỘC dùng "huynh-đệ", "ta-ngươi", "tỷ-muội", "tiền bối-hậu bối".
         - NHÓM B (Hiện đại/Đô thị/Thập niên 80-90, bối cảnh Trái Đất đời thực): BẮT BUỘC dùng "tôi", "bạn", "chú", "dì".
         - NHÓM C (Light Novel Hàn/Nhật/Anh, Fantasy/Dị giới/Học viện phương Tây - KHÔNG phải Trung Hoa cổ trang, KHÔNG phải hiện đại Trái Đất): BẮT BUỘC dùng xưng hô tự nhiên kiểu phương Tây/light novel (tôi/ta - ngài/cô/cậu/anh, tiểu thư, ngài + tước hiệu, huân tước, bệ hạ), TUYỆT ĐỐI KHÔNG tự ý sửa về "ta-ngươi"/"tiền bối-hậu bối" kiểu kiếm hiệp cho nhóm này chỉ vì nó không phải "hiện đại".
         - THỂ LOẠI LAI (HYBRID): Nếu 2 nhân vật đến từ 2 nhóm bối cảnh khác nhau (vd nhân vật xuyên không hiện đại + người bản địa cổ trang), giữ nguyên cách xưng hô RIÊNG của từng bên như bản phân tích gốc đã ghi, KHÔNG ép về chung 1 nhóm.
         CHỈ sửa lại xưng hô nếu phát hiện SAI NHÓM theo đúng bối cảnh thật của truyện, không mặc định quy về Cổ trang khi bối cảnh chưa rõ.)


### CẤU TRÚC ĐẦU RA:
# 1. THÔNG TIN CƠ BẢN
# 2. TỪ ĐIỂN PHÂN LOẠI (GLOSSARY)
# 3. NGỮ CẢNH & SỰ KIỆN QUAN TRỌNG
# 4. TIẾN TRÌNH CỐT TRUYỆN TÍCH LŨY
# 5. GHI CHÚ DỊCH THUẬT
# === [7. XƯNG HÔ & QUAN HỆ / PRONOUNS] ===
(Liệt kê các Ma trận xưng hô đã hợp nhất tại đây)
`;

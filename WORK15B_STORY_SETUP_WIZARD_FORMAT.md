# WORK15B — Story Setup Wizard và định dạng Setup tác giả

## Audit trước chỉnh sửa

Audit bắt đầu từ main sạch và đồng bộ local/remote tại f46ea8a9a4aa4d66c655cf92ce1a032d67a49801. Các bề mặt đã đọc gồm StoryStudioPage/empty state/Project Library/action bar, useStoryStudio, controller/repository/types WORK15A, setup import/review, Gemini Story Setup compiler, StoryBlueprintDocument parser/compiler, timing/POV audit, storage IndexedDB, download helpers và các suite WORK12–15.

Kết luận ranh giới: setupDocument là thiết kế bền vững duy nhất cần đọc cho export; FullStoryControl tiếp tục được derive, không persist. Raw Author Secret chỉ được phép trong nguồn tác giả/draft/export chủ động; Review Setup thông thường chỉ trình bày count. coreIdentity vẫn nhận displayName, setupDocument, storyControlIdentity, StoryState, NarrativeMemoryState, chapter metadata và createdAt; workflowIdentity vẫn chỉ nhận workflow/batch queue; storyControlIdentity vẫn nhận FullStoryControl đã compile. Canon, memory record, artifact và chapter-metadata identities không nhận dữ liệu wizard/library/UI.

## Ba đường vào Story Setup

Story Studio cung cấp ba đường tạo dự án, cùng hội tụ tại ranh giới kiểm tra V4 hiện hữu:

1. **Tạo truyện mới** mở wizard tiếng Việt 9 bước.
2. **Nhập Setup TXT/MD** nhận thiết kế truyện do người hoặc công cụ AI khác soạn.
3. **Nhập V4 JSON (nâng cao / offline)** dùng parser nghiêm ngặt mà không gọi model.

**Tải mẫu Setup** chỉ tải một mẫu Markdown trống. Việc điền, xem trước, lưu draft, tải mẫu và tải bản xem trước không gọi Gemini. Chỉ thao tác rõ ràng **Biên dịch & kiểm tra Setup** hoặc nhập TXT/MD mới gọi compiler Gemini hiện hữu.

## Kiến trúc wizard

Luồng thực thi:

    WizardDraftV1 của tác giả
      -> renderer Markdown xác định
      -> compiler Author Setup TXT/MD hiện hữu
      -> StoryBlueprintDocument formatVersion 1
      -> parser nghiêm ngặt + compile StoryControl V4 + timing/POV audit
      -> Review Setup V4
      -> xác nhận tạo dự án WORK15A mới tại C0

Wizard là lớp soạn thảo, không phải một Story Engine khác. ID thẻ nhân vật/quan hệ trong draft là ID UI cục bộ, không đi vào Markdown, Blueprint, project library, Canon, memory, workflow hay artifact identity.

Thứ tự view-state là: loading; Review Setup đã được cấp quyền; wizard đã được cấp quyền; core-corrupt; no-active; Studio/demo. Trong trạng thái core-corrupt, wizard/review chỉ được phép khi repository đã cung cấp một snapshot project library hợp lệ. Legacy corrupt hoặc index không đáng tin tiếp tục fail-closed.

## Wizard 9 bước

1. Thông tin cơ bản.
2. Ý tưởng cốt lõi.
3. Nhân vật có thể thêm, xóa và đổi thứ tự.
4. Thế giới và hệ thống, với gợi ý trình bày thích ứng theo thể loại.
5. Cốt truyện và nhịp dài.
6. Quan hệ / tình cảm theo từng cặp hoặc nhóm.
7. Chiến lược / chính trị / quân sự / thương nghiệp tùy chọn.
8. Bí mật tác giả và luật Canon.
9. Xem lại, xem Markdown, tải Markdown và biên dịch.

Thích ứng thể loại chỉ thay lời gợi ý trong UI. Nó không tạo nhánh schema hoặc mô hình Canon riêng.

## Draft persistence

- Key: story_studio_v4_setup_wizard_draft_v1
- Kind: story-setup-wizard-draft
- Format version: 1
- Storage: cùng abstraction IndexedDB session record hiện hữu, nhưng là record riêng với project library và project documents.
- Parser yêu cầu discriminator, version, đầy đủ field, không field lạ, card ID không rỗng/không trùng.
- Draft có thể chứa bí mật tác giả và không được log/telemetry.
- F5 nạp lại draft và mở lại wizard khi trạng thái library đủ tin cậy.
- Draft corrupt được giữ nguyên; chỉ xóa sau xác nhận riêng.
- Các lần ghi được serialize.
- Compiler/create thất bại không xóa draft.
- Sau durable project create và publish thành công, draft do wizard tạo mới được xóa. Lỗi cleanup không làm mất project đã tạo và để draft retryable.

## Markdown Setup tác giả

Renderer dùng tiêu đề tiếng Việt ổn định cho thông tin cơ bản, premise, phong cách/POV, nhân vật, thế giới, hệ thống sức mạnh, arc, turning point, quan hệ, chiến lược, foreshadow/reveal/payoff, luật Canon, điều cấm và bí mật tác giả. Cùng một input đã chuẩn hóa sinh cùng một output; nội dung nhiều dòng được giữ nguyên; phần tùy chọn trống được bỏ.

Mẫu tải về giải thích rõ nội dung trong ngoặc vuông chỉ là placeholder và có câu lệnh ngắn để dùng với AI ngoài ứng dụng: giữ nguyên tiêu đề và không xóa phần bí mật tác giả. Mẫu không chứa dữ liệu người dùng, API key, ID hay thuật ngữ nội bộ.

## Xuất Setup và backup tiếp tục

**Xuất Setup** đọc duy nhất setupDocument và tạo Markdown thiết kế có thể sửa. Tác giả phải xác nhận cảnh báo spoiler/bí mật trước khi tải. Nội dung không được đưa vào state UI thông thường hoặc log.

Setup export:

- có thể chứa Author Secret vì đây là artifact tác giả chủ động yêu cầu;
- không gọi Gemini;
- không sửa project hay bất kỳ identity nào;
- khi nhập lại sẽ qua compiler/review và tạo **dự án mới từ C0**;
- không chứa Canon hiện tại, lịch sử chương, Narrative Memory hoặc workflow checkpoint.

Portable full-project continuation backup/restore thuộc WORK15C và không được triển khai ở đây.

## Author Secret boundary

Wizard/draft/template-export là bề mặt do tác giả sở hữu. Sau compile, ranh giới cũ tiếp tục áp dụng: Review Setup thường chỉ hiển thị số lượng bí mật; raw secret không đi tới Writer, Repair, Extractor, diagnostic hoặc console. WORK15B không sửa context builders hay provider adapters.

## Tương thích

- StoryStudioProjectDocumentV1.formatVersion vẫn là 1.
- Story Engine schemaVersion vẫn là 4.
- Không thêm project ID, wizard ID, draft ID, filename hay catalog metadata vào core/workflow/StoryControl/Canon/memory/artifact identity.
- Migration, typed corrupt recovery, bounded active-save reads, switch/delete/rename và selection rules của WORK15A không đổi.
- Hosted Gemini bridge WORK14 và pipeline WORK13/WORK12 không đổi.
- Legacy Sáng Tác / Creative không bị sửa.
- Không có provider, API trả phí, backend, EPUB hoặc full-project backup mới.

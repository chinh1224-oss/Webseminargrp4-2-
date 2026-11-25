# Sổ Phân liều

Công cụ tính Liều hiệu dụng sinh học (BED) cho seminar xạ trị giảm phân liều, Nhóm 4, Khoa Vật lý – Vật lý Kỹ thuật, Trường Đại học Khoa học Tự nhiên, Đại học Quốc gia TP.HCM.

Đây là bản thiết kế lại của công cụ trong `website/`: cùng nội dung và cùng bốn module, nhưng khác hoàn toàn về hướng thị giác và cách tổ chức.

## Mở thế nào

Mở trực tiếp `index.html` bằng Chrome, Edge hoặc Firefox. Không cần máy chủ, không cần cài thêm gì.

```
website-ledger/
├── index.html    bố cục và nội dung
├── styles.css    hệ thống thiết kế
└── app.js        bốn module, đồ thị, bảng đối chiếu, CSV, chế độ in
```

## Bốn module theo đề bài

| Module | Việc nó làm | Công thức chính |
| --- | --- | --- |
| 1. BED cơ bản | BED và EQD2 cho mô bướu và mô lành, không tính tái sinh, kèm dải bất định α/β | BED = n·d·(1 + d/(α/β)); EQD2 = BED/(1 + 2/(α/β)) |
| 2. Tái sinh | BED hiệu dụng bị mất khi tổng thời gian T vượt T<sub>k</sub> | BED_net = BED − K·max(0, T − T<sub>k</sub>); K = ln2/(α·T<sub>pot</sub>) |
| 3. Chuyển đổi | Giải phác đồ mới (n₂, d₂) sao cho bảo toàn BED trên mô bướu hoặc mô lành | d₂ = [−(α/β) + √((α/β)² + 4(α/β)·BED/n₂)]/2 |
| 4. Bù gián đoạn | Ba phương án bù khi phác đồ bị ngắt, kèm mức tăng BED mô lành | ΔBED = K·[max(0, T_new − T<sub>k</sub>) − max(0, T_plan − T<sub>k</sub>)] |

Ngoài ra có bảng đối chiếu bảy phác đồ lấy từ Bảng 3.1 của báo cáo (prostate chuẩn, CHHiP, PACE-B, vú chuẩn, START-B, FAST-Forward, RTOG 0236), thêm được phác đồ từ mỗi module, xuất CSV và in cả trang.

## Hướng thiết kế

Ý tưởng chủ đạo là **dải phân liều**: mỗi khối là một lần chiếu, độ dài cả thanh tỷ lệ với tổng liều. Phác đồ 39 lần × 2 Gy thành thanh dài và mảnh; phác đồ 20 lần × 3 Gy thành thanh ngắn hơn nhưng khối dày hơn. Hình này xuất hiện ở phần mở đầu và ở module 1, 3, 4 nên toàn trang dùng chung một ngôn ngữ thị giác lấy từ chính đối tượng nghiên cứu.

Khác với bản cũ (nền tối kiểu console TPS, nhấn amber, điều hướng bằng tab):

- **Nền giấy xanh nhạt** `#F0F2EA` có lưới ô vuông mờ ở phần mở đầu, gợi giấy vẽ đồ thị liều.
- **Bảng màu:** petrol `#1D5B54` cho cấu trúc và mô lành, magenta `#A3215B` cho liều và mô bướu, ochre `#8A5A0F` chỉ dùng cho cảnh báo. Chữ `#17231E`.
- **Kiểu chữ:** Be Vietnam Pro cho tiêu đề, nhãn và số (được thiết kế cho tiếng Việt); Source Serif 4 cho đoạn văn. Không dùng monospace.
- **Bố cục cuộn một mạch** với thanh mục lục dính thay cho bốn tab. Mỗi module: tiêu đề, cột nhập liệu dạng sổ (nhãn bên trái, ô số bên phải), hàng số đọc không đóng khung, rồi dải phân liều hoặc đồ thị, cuối cùng là một câu đọc kết quả.
- **Chuyển động có chủ đích:** hai dải ở phần mở đầu vẽ ra một lần khi tải; các dải khác chỉ đổi khi người đọc sửa số. Tôn trọng `prefers-reduced-motion`.

Ảnh chụp: `preview/desktop.png`, `preview/mobile.png`, `preview/print.png`.

## Đã kiểm chứng

- Số liệu khớp Bảng 3.2 của báo cáo: module 1 cho 180.00 Gy và 120.00 Gy; module 2 cho K = 0.578 Gy/ngày, mất 15.02 Gy, BED_net = 68.98 Gy; module 3 cho d₂ = 3.02 Gy; module 4 mất 4.20 Gy BED khi nghỉ 7 ngày.
- Kiểm thử tự động bằng Chrome DevTools Protocol: đổi phác đồ mẫu, cảnh báo khi liều mỗi lần trên 10 Gy, đổi loại đồ thị, thêm và xóa dòng trong bảng, xuất CSV, Enter trong ô số không tải lại trang — không có lỗi runtime.
- Bố cục đã xem ở 1440, 768, 500 và 390 px; bản in 7 trang A4, không tràn ngang.

## Giới hạn

Trang dùng mô hình tuyến tính – toàn phương. Với liều mỗi lần trên 8–10 Gy, mô hình đánh giá quá cao hiệu quả diệt tế bào; cần đối chiếu USC hoặc LQL và tuân thủ AAPM TG-101. Công cụ dùng cho học tập, không thay thế tính toán lâm sàng.

## Tài liệu

Fowler (1989); Joiner & van der Kogel (2018); RCR (2019); Benedict et al., AAPM TG-101 (2010); Dearnaley et al., CHHiP (2016); START Trialists' Group (2008); Brunt et al., FAST-Forward (2020).

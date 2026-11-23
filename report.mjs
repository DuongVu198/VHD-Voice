const number = value => value == null ? "" : String(value).replace(".", ",");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function assetTable(title, headers, rows, values) {
  const section = element("section", null, "report-section");
  section.append(element("h2", title));
  const table = element("table");
  const caption = element("caption", title);
  caption.className = "report-sr-only";
  const head = element("thead");
  const heading = element("tr");
  for (const label of headers) {
    const cell = element("th", label);
    cell.scope = "col";
    heading.append(cell);
  }
  head.append(heading);
  const body = element("tbody");
  for (const row of rows) {
    const line = element("tr");
    if (row.kind === "title") {
      const cell = element("td", row.name, "report-group");
      cell.colSpan = headers.length;
      line.append(cell);
    } else {
      for (const value of values(row)) line.append(element("td", value ?? ""));
    }
    body.append(line);
  }
  if (!rows.length) {
    const line = element("tr");
    const cell = element("td", "Chưa có tài sản.");
    cell.colSpan = headers.length;
    line.append(cell);
    body.append(line);
  }
  table.append(caption, head, body);
  section.append(table);
  return section;
}

export function openHouseholdReport(record) {
  document.getElementById("household-report")?.remove();
  const previousTitle = document.title;
  const previousFocus = document.activeElement;
  const report = element("section", null, "household-report");
  report.id = "household-report";
  report.setAttribute("aria-label", "Bản kiểm kê để lưu PDF");
  const toolbar = element("div", null, "report-toolbar");
  const back = element("button", "Quay lại", "secondary");
  back.type = "button";
  back.addEventListener("click", () => {
    document.body.classList.remove("show-report");
    document.title = previousTitle;
    report.remove();
    previousFocus?.focus();
  });
  const print = element("button", "Lưu PDF / In", "primary");
  print.type = "button";
  print.addEventListener("click", () => window.print());
  toolbar.append(back, print, element("p",
    "Chỉ gồm các dòng đã bấm Lưu. Trên máy tính: chọn Lưu dưới dạng PDF. Trên iPhone: mở rộng bản xem trước bằng hai ngón tay, rồi Chia sẻ → Lưu vào Tệp."));
  const sheet = element("article", null, "report-sheet");
  sheet.append(element("h1", "BẢNG KIỂM KÊ TÀI SẢN"),
    element("p", "Họ và tên chủ hộ: " + record.name, "report-household"),
    element("p", "Ngày xuất: " + new Date().toLocaleDateString("vi-VN")));
  sheet.append(assetTable("I. NHÀ / CÔNG TRÌNH",
    ["Tên tài sản", "Thông số kỹ thuật"], record.house,
    row => [row.name, row.spec]));
  sheet.append(assetTable("II. CÂY",
    ["Tên cây", "Đường kính (cm)", "Chiều cao (m)", "Số lượng (cây)"], record.tree,
    row => [row.name, number(row.diameterCm), number(row.heightM), number(row.quantity)]));
  report.append(toolbar, sheet);
  document.body.append(report);
  document.title = "GPMB - " + record.name;
  document.body.classList.add("show-report");
  window.scrollTo(0, 0);
  print.focus();
}

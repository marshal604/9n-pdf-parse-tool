# 9n PDF 單字擷取工具

從 PDF 文件中擷取英文單字的網頁工具，適合用於處理單字表、講義等教學文件。

**Demo**: https://marshal604.github.io/9n-pdf-parse-tool/

## 功能特色

- **PDF 解析**：上傳 PDF 檔案，自動擷取其中的英文單字
- **智慧過濾**：自動移除中文、數字、括號內容、單一字母
- **黑名單機制**：可自訂要過濾的單字（如人名、常見詞等），設定會儲存在瀏覽器中
- **搜尋功能**：即時搜尋已擷取的單字
- **A-Z 排序**：單字自動依字母順序排列
- **匯出功能**：可將單字清單下載為 TXT 檔案

## 安裝

```bash
# 安裝相依套件
npm install

# 啟動開發伺服器
npm run dev
```

## 使用方式

1. 開啟網頁後，點擊「選擇 PDF 檔案」上傳你的 PDF
2. 工具會自動解析並擷取英文單字
3. 可在黑名單區塊新增要過濾的單字
4. 使用搜尋框快速查找特定單字
5. 點擊「下載 TXT」匯出單字清單

## 技術架構

- [React](https://react.dev/) 19
- [Vite](https://vite.dev/) 7
- [PDF.js](https://mozilla.github.io/pdf.js/) - Mozilla 的 PDF 解析函式庫

## 建置

```bash
# 建置生產版本
npm run build

# 預覽生產版本
npm run preview

# 部署到 GitHub Pages
npm run deploy
```

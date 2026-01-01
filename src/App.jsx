import { useState, useMemo, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import englishWords from 'an-array-of-english-words';

// 設定 PDF.js worker (使用 unpkg CDN 確保版本匹配)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// 建立英文單字 Set 以便快速查詢
const englishWordSet = new Set(englishWords.map(w => w.toLowerCase()));

// 預設黑名單
const DEFAULT_BLACKLIST = [
  'Big Bird',
  'Elmo',
  'Cookie Monster',
  'Ernie',
  'Bert',
  'Grover',
  'Abby',
  'Zoe',
  'Furry Monster',
  'Lady Dinah'
];

const STORAGE_KEY = 'vocabulary-blacklist';

function App() {
  const [vocabularyData, setVocabularyData] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [fileNames, setFileNames] = useState([]);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [blacklist, setBlacklist] = useState([]);
  const [newBlacklistWord, setNewBlacklistWord] = useState('');
  const [rawParseData, setRawParseData] = useState(null);
  const [ocrProgress, setOcrProgress] = useState('');
  const [showOcrSuggestion, setShowOcrSuggestion] = useState(false);
  const [parsePattern, setParsePattern] = useState('SSE'); // 'SSE' | 'vob-K-S-unit'
  const pendingFilesRef = useRef(null);

  // 從 localStorage 載入黑名單
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setBlacklist(JSON.parse(stored));
    } else {
      setBlacklist(DEFAULT_BLACKLIST);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_BLACKLIST));
    }
  }, []);

  // 儲存黑名單到 localStorage
  const saveBlacklist = (newList) => {
    setBlacklist(newList);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newList));
  };

  // 新增黑名單單字
  const addToBlacklist = () => {
    const word = newBlacklistWord.trim();
    if (word && !blacklist.some(w => w.toLowerCase() === word.toLowerCase())) {
      saveBlacklist([...blacklist, word]);
      setNewBlacklistWord('');
    }
  };

  // 刪除黑名單單字
  const removeFromBlacklist = (wordToRemove) => {
    saveBlacklist(blacklist.filter(w => w !== wordToRemove));
  };

  // 使用 OCR 解析單一 PDF 檔案
  const parsePdfWithOcr = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let allText = [];
    const rawData = {
      fileName: file.name,
      mode: 'OCR',
      pages: []
    };

    for (let i = 1; i <= pdf.numPages; i++) {
      setOcrProgress(`OCR 處理中: ${file.name} 第 ${i}/${pdf.numPages} 頁`);

      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 }); // 放大 2 倍提高辨識率

      // 建立 canvas 來渲染 PDF 頁面
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      // 用 Tesseract 辨識
      const result = await Tesseract.recognize(canvas, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(`OCR 處理中: ${file.name} 第 ${i}/${pdf.numPages} 頁 (${Math.round(m.progress * 100)}%)`);
          }
        }
      });

      const pageText = result.data.text;
      const words = pageText
        .split(/[\s\n]+/)
        .map(w => w.trim())
        .filter(w => w.length > 0);

      allText.push(...words);

      rawData.pages.push({
        pageNumber: i,
        rawText: pageText,
        words
      });
    }

    return { allText, rawData };
  };

  // 解析單一 PDF 檔案（返回原始資料和處理後的文字）
  const parsePdf = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let allText = [];
    const rawData = {
      fileName: file.name,
      pages: []
    };

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // 原始 items 資料
      const rawItems = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height
      }));

      // 按 y 座標分組（同一行），容差 3
      const rows = {};
      textContent.items.forEach(item => {
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!rows[y]) rows[y] = [];
        rows[y].push({
          text: item.str,
          x: item.transform[4]
        });
      });

      // 處理後的行資料
      const processedRows = [];

      // 每行按 x 排序，組合文字直到遇到空格
      Object.entries(rows).forEach(([yKey, row]) => {
        row.sort((a, b) => a.x - b.x);

        const rowData = {
          y: Number(yKey),
          items: [...row],
          cells: [],
          skipped: false,
          skipReason: null
        };

        // 找第一個非空白的 text，檢查是否以數字或中文開頭
        const firstNonEmpty = row.find(item => item.text.trim() !== '');
        if (firstNonEmpty) {
          const firstChar = firstNonEmpty.text.trim().charAt(0);
          // 如果是數字或中文開頭，跳過整行
          if (/\d/.test(firstChar) || /[\u4e00-\u9fff]/.test(firstChar)) {
            rowData.skipped = true;
            rowData.skipReason = /\d/.test(firstChar) ? 'starts with number' : 'starts with Chinese';
            processedRows.push(rowData);
            return;
          }
        }

        let cellText = '';

        row.forEach(item => {
          let text = item.text;

          // 過濾掉 *
          text = text.replace(/\*/g, '');

          if (text.trim() === '') {
            // 遇到空格，儲存前面累積的文字
            if (cellText) {
              allText.push(cellText);
              rowData.cells.push(cellText);
            }
            cellText = '';
          } else {
            // 繼續組合
            cellText += text;
          }
        });

        // 儲存最後累積的文字
        if (cellText) {
          allText.push(cellText);
          rowData.cells.push(cellText);
        }

        processedRows.push(rowData);
      });

      rawData.pages.push({
        pageNumber: i,
        rawItems,
        processedRows
      });
    }

    return { allText, rawData };
  };

  // Pattern 1 (vob-K-S-unit) 的文字處理：從 OCR rawText 提取單字
  const filterTextPattern1 = (rawDataList) => {
    const blacklistLower = blacklist.map(w => w.toLowerCase());
    const seen = new Set();
    const allWords = [];

    rawDataList.forEach(fileData => {
      fileData.pages.forEach(page => {
        const rawText = page.rawText || '';
        const pageNumber = page.pageNumber || 1;

        // pageNumber 1：忽略前兩個 \n 之前的內容
        // 其他 pageNumber：忽略第一個 \n 之前的內容
        let textToProcess = rawText;
        if (pageNumber === 1) {
          const firstNewline = rawText.indexOf('\n');
          if (firstNewline >= 0) {
            const secondNewline = rawText.indexOf('\n', firstNewline + 1);
            if (secondNewline >= 0) {
              textToProcess = rawText.substring(secondNewline + 1);
            } else {
              textToProcess = rawText.substring(firstNewline + 1);
            }
          }
        } else {
          const firstNewline = rawText.indexOf('\n');
          if (firstNewline >= 0) {
            textToProcess = rawText.substring(firstNewline + 1);
          }
        }

        // 先移除 U1-U1000、V1-V1000 等單元標記（在正則匹配之前）
        // OCR 可能辨識錯：U→u, 1→I/l, 0→O, 5→S/s, 8→B/s
        textToProcess = textToProcess.replace(/\b[Uu][0-9IlOSBs]+\b/g, '');
        textToProcess = textToProcess.replace(/\b[Vv][0-9IlOSBs]+\b/g, '');

        // 匹配類似 "Big Bird (1A)" 或 "friend(s) (1B)" 的模式
        // 格式：單字（可能有括號如(s)）後面跟著空格和 (1A)/(1B) 等
        // OCR 可能把數字辨識錯：1→I/l, 0→O, 2→Z, 5→S, 8→B
        // 注意：用 [ ] 而非 \s，避免匹配換行符導致跨行匹配
        const pattern = /([A-Za-z][A-Za-z ]*(?:\([a-z]+\))?)\s*\([\dIlOZSB]+[A-Z]\)/g;
        let match;

        while ((match = pattern.exec(textToProcess)) !== null) {
          let word = match[1].trim();
          // 移除單字中的 (s), (ed) 等括號內容
          word = word.replace(/\([^)]*\)/g, '').trim();
          if (word) {
            allWords.push(word);
          }
        }
      });
    });

    // 檢查單字是否在英文字典中（多個單字的片語分開檢查）
    const isValidEnglish = (text) => {
      const words = text.toLowerCase().split(/\s+/);
      return words.every(w => englishWordSet.has(w));
    };

    // 過濾和去重，並標記可疑單字
    return allWords
      .flatMap((text) => text.split('/')) // 分割 had/has → ['had', 'has']
      .map(text => text.trim())
      .filter(text => text.length > 1)
      .filter(text => /^[a-zA-Z]/.test(text))
      .filter(text => !/[\u4e00-\u9fff]/.test(text))
      .filter(text => !/\d/.test(text))
      .filter(text => !blacklistLower.some(word => text.toLowerCase().includes(word)))
      .filter(text => {
        const lower = text.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      })
      .map(text => ({
        word: text,
        suspicious: !isValidEnglish(text)
      }));
  };

  // Pattern 2 (SSE) 的文字過濾：原本的邏輯
  const filterTextPattern2 = (allText) => {
    const blacklistLower = blacklist.map(w => w.toLowerCase());
    const seen = new Set();

    // 檢查單字是否在英文字典中
    const isValidEnglish = (text) => {
      const words = text.toLowerCase().split(/\s+/);
      return words.every(w => englishWordSet.has(w));
    };

    return allText
      .map(text => text.replace(/\([^)]*\)/g, '')) // 移除括號及其內容
      .flatMap(text => text.split('/')) // 分割 had/has → ['had', 'has']
      .map(text => text.trim())
      .filter(text => text.length > 1) // 移除一個字母的
      .filter(text => /^[a-zA-Z]/.test(text)) // 開頭必須是字母
      .filter(text => !/[\u4e00-\u9fff]/.test(text)) // 移除含中文的
      .filter(text => !/\d/.test(text)) // 移除含數字的
      .filter(text => !blacklistLower.some(word => text.toLowerCase().includes(word))) // 移除包含黑名單的
      .filter(text => { // 去除重複（不分大小寫）
        const lower = text.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      })
      .map(text => ({
        word: text,
        suspicious: !isValidEnglish(text)
      }));
  };

  // 處理 PDF 上傳（支援多檔案）
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    await processFiles(files, parsePattern);
  };

  // 處理檔案（根據 pattern 選擇解析方式）
  const processFiles = async (files, pattern) => {
    const pdfFiles = files.filter(file => file.type === 'application/pdf');

    if (pdfFiles.length === 0) {
      alert('請上傳 PDF 檔案');
      return;
    }

    if (pdfFiles.length !== files.length) {
      alert(`已忽略 ${files.length - pdfFiles.length} 個非 PDF 檔案`);
    }

    setIsLoading(true);
    setFileNames(pdfFiles.map(f => f.name));
    setShowOcrSuggestion(false);
    setOcrProgress('');
    pendingFilesRef.current = pdfFiles;

    try {
      // Pattern 1 使用 OCR，Pattern 2 使用一般解析
      const useOcr = pattern === 'vob-K-S-unit';
      const parseFunc = useOcr ? parsePdfWithOcr : parsePdf;

      let results;
      if (useOcr) {
        // OCR 需要逐個處理（顯示進度）
        results = [];
        for (const file of pdfFiles) {
          const result = await parseFunc(file);
          results.push(result);
        }
      } else {
        // 一般解析可以並行
        results = await Promise.all(pdfFiles.map(parseFunc));
      }

      const allRawData = results.map(r => r.rawData);
      setRawParseData(allRawData);

      // 根據 pattern 選擇不同的過濾邏輯
      let filteredText;
      if (pattern === 'vob-K-S-unit') {
        filteredText = filterTextPattern1(allRawData);
      } else {
        const allText = results.flatMap(r => r.allText);
        filteredText = filterTextPattern2(allText);
      }

      setVocabularyData(filteredText);

      // Pattern 2 且單字數量少於 10，提醒用戶可以試試 Pattern 1
      if (pattern === 'SSE' && filteredText.length < 10) {
        setShowOcrSuggestion(true);
      }

    } catch (error) {
      console.error('PDF 處理失敗:', error);
      alert('PDF 處理失敗，請確認檔案格式');
    } finally {
      setIsLoading(false);
      setOcrProgress('');
    }
  };

  // 用 Pattern 1 (OCR) 重新解析
  const retryWithPattern1 = async () => {
    if (pendingFilesRef.current) {
      setShowOcrSuggestion(false);
      setParsePattern('vob-K-S-unit');
      await processFiles(pendingFilesRef.current, 'vob-K-S-unit');
    }
  };

  // 過濾並排序單字 (A-Z)
  const filteredWords = useMemo(() => {
    let words = vocabularyData;

    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase();
      words = words.filter(item =>
        item.word.toLowerCase().includes(searchLower)
      );
    }

    // 按字母排序 (A-Z)
    return [...words].sort((a, b) =>
      a.word.toLowerCase().localeCompare(b.word.toLowerCase())
    );
  }, [searchText, vocabularyData]);

  // 計算可疑單字數量
  const suspiciousCount = useMemo(() =>
    filteredWords.filter(item => item.suspicious).length
  , [filteredWords]);

  // 下載為 txt 檔案
  const downloadAsTxt = () => {
    const content = filteredWords.map(item => item.word).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNames.length === 1
      ? fileNames[0].replace('.pdf', '.txt')
      : 'vocabulary.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 下載原始解析資料為 JSON
  const downloadAsJson = () => {
    if (!rawParseData) return;
    const content = JSON.stringify(rawParseData, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pdf-parse-debug.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '20px' }}>單字表</h1>

      {/* PDF 上傳區 */}
      <div style={{
        marginBottom: '30px',
        padding: '20px',
        border: '2px dashed #ccc',
        borderRadius: '8px',
        textAlign: 'center',
        backgroundColor: '#f9f9f9'
      }}>
        {/* Pattern 選擇 */}
        <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'center', gap: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="parsePattern"
              value="SSE"
              checked={parsePattern === 'SSE'}
              onChange={(e) => setParsePattern(e.target.value)}
              style={{ width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '14px' }}>
              SSE（一般 PDF）
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="parsePattern"
              value="vob-K-S-unit"
              checked={parsePattern === 'vob-K-S-unit'}
              onChange={(e) => setParsePattern(e.target.value)}
              style={{ width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '14px' }}>
              vob-K-S-unit（掃描檔/OCR）
            </span>
          </label>
        </div>

        <input
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileUpload}
          style={{ display: 'none' }}
          id="pdf-upload"
        />
        <label
          htmlFor="pdf-upload"
          style={{
            padding: '10px 20px',
            backgroundColor: parsePattern === 'vob-K-S-unit' ? '#fd7e14' : '#007bff',
            color: 'white',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            display: 'inline-block',
            opacity: isLoading ? 0.7 : 1
          }}
        >
          {isLoading
            ? (ocrProgress || '處理中...')
            : `選擇 PDF 檔案（可多選）`
          }
        </label>

        {fileNames.length > 0 && !isLoading && (
          <div style={{ marginTop: '10px' }}>
            <p style={{ color: '#666', marginBottom: '8px' }}>
              已上傳：{fileNames.length === 1 ? fileNames[0] : `${fileNames.length} 個檔案`}
            </p>
            <button
              onClick={downloadAsJson}
              style={{
                padding: '6px 12px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              下載 Debug JSON
            </button>
          </div>
        )}
      </div>

      {/* Pattern 建議提醒 */}
      {showOcrSuggestion && (
        <div style={{
          marginBottom: '20px',
          padding: '15px',
          border: '1px solid #ffc107',
          borderRadius: '8px',
          backgroundColor: '#fff3cd',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <span style={{ color: '#856404' }}>
            偵測到的單字很少，這可能是掃描檔或圖片 PDF。要試試用 vob-K-S-unit 模式重新解析嗎？
          </span>
          <button
            onClick={retryWithPattern1}
            style={{
              padding: '8px 16px',
              backgroundColor: '#fd7e14',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            使用 vob-K-S-unit 重新解析
          </button>
        </div>
      )}

      {/* 黑名單顯示區 */}
      <div style={{
        marginBottom: '20px',
        padding: '15px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        backgroundColor: '#fff8f8'
      }}>
        <div
          onClick={() => setShowBlacklist(!showBlacklist)}
          style={{
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span style={{ fontWeight: 'bold', color: '#c00' }}>
            黑名單 ({blacklist.length} 個單字)
          </span>
          <span>{showBlacklist ? '▲ 收合' : '▼ 展開'}</span>
        </div>
        {showBlacklist && (
          <>
            {/* 新增黑名單輸入 */}
            <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
              <input
                type="text"
                placeholder="輸入要過濾的單字..."
                value={newBlacklistWord}
                onChange={(e) => setNewBlacklistWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addToBlacklist()}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
              />
              <button
                onClick={addToBlacklist}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#c00',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                新增
              </button>
            </div>

            {/* 黑名單列表 */}
            <div style={{
              marginTop: '15px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px'
            }}>
              {blacklist.map((word, index) => (
                <span
                  key={index}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: '#ffdddd',
                    borderRadius: '4px',
                    fontSize: '14px',
                    color: '#900',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {word}
                  <button
                    onClick={() => removeFromBlacklist(word)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#900',
                      cursor: 'pointer',
                      padding: '0',
                      fontSize: '16px',
                      lineHeight: 1
                    }}
                    title="移除"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 搜尋框 - 只在有資料時顯示 */}
      {vocabularyData.length > 0 && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <input
                type="text"
                placeholder="搜尋單字..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{
                  flex: 1,
                  padding: '10px',
                  fontSize: '16px',
                  border: '2px solid #ddd',
                  borderRadius: '4px'
                }}
              />
              <button
                onClick={downloadAsTxt}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  whiteSpace: 'nowrap'
                }}
              >
                下載 TXT
              </button>
            </div>
            <p style={{ color: '#666' }}>
              顯示 {filteredWords.length} / {vocabularyData.length} 項 (A-Z 排序)
              {suspiciousCount > 0 && (
                <span style={{ marginLeft: '10px', color: '#856404' }}>
                  ⚠ {suspiciousCount} 個可疑單字
                </span>
              )}
            </p>
          </div>

          {/* 單字列表 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '10px'
          }}>
            {filteredWords.map((item, index) => (
              <div
                key={index}
                style={{
                  padding: '10px',
                  border: item.suspicious ? '2px solid #ffc107' : '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: item.suspicious ? '#fff3cd' : '#f9f9f9',
                  wordBreak: 'break-word'
                }}
                title={item.suspicious ? '可疑單字：不在英文字典中' : ''}
              >
                {item.word}
                {item.suspicious && <span style={{ marginLeft: '6px', color: '#856404' }}>⚠</span>}
              </div>
            ))}
          </div>

          {/* 沒有結果 */}
          {filteredWords.length === 0 && (
            <p style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>
              找不到符合的單字
            </p>
          )}
        </>
      )}

      {/* 尚未上傳提示 */}
      {vocabularyData.length === 0 && !isLoading && (
        <p style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>
          請上傳 PDF 檔案以開始
        </p>
      )}
    </div>
  );
}

export default App;

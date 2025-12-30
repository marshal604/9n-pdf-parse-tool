import { useState, useMemo, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// 設定 PDF.js worker (使用 unpkg CDN 確保版本匹配)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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
  const [fileName, setFileName] = useState('');
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [blacklist, setBlacklist] = useState([]);
  const [newBlacklistWord, setNewBlacklistWord] = useState('');

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

  // 處理 PDF 上傳
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      alert('請上傳 PDF 檔案');
      return;
    }

    setIsLoading(true);
    setFileName(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let allText = [];

      // ============ 第一階段：PDF Parse ============
      // 1. 把 * 都過濾掉
      // 2. 依序把每個 text 組合起來，直到遇到空格

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

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

        // 每行按 x 排序，組合文字直到遇到空格
        Object.values(rows).forEach(row => {
          row.sort((a, b) => a.x - b.x);

          // 找第一個非空白的 text，檢查是否以數字或中文開頭
          const firstNonEmpty = row.find(item => item.text.trim() !== '');
          if (firstNonEmpty) {
            const firstChar = firstNonEmpty.text.trim().charAt(0);
            // 如果是數字或中文開頭，跳過整行
            if (/\d/.test(firstChar) || /[\u4e00-\u9fff]/.test(firstChar)) {
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
          }
        });
      }

      // ============ 第二階段：文字處理 ============
      // 1. 把括號跟括號裡面的字都移除
      // 2. 移除：中文、數字、黑名單單字
      // 3. 去除重複

      const blacklistLower = blacklist.map(w => w.toLowerCase());
      const seen = new Set();

      const filteredText = allText
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
        });

      setVocabularyData(filteredText);

    } catch (error) {
      console.error('PDF 處理失敗:', error);
      alert('PDF 處理失敗，請確認檔案格式');
    } finally {
      setIsLoading(false);
    }
  };

  // 過濾並排序單字 (A-Z)
  const filteredWords = useMemo(() => {
    let words = vocabularyData;

    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase();
      words = words.filter(word =>
        word.toLowerCase().includes(searchLower)
      );
    }

    // 按字母排序 (A-Z)
    return [...words].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [searchText, vocabularyData]);

  // 下載為 txt 檔案
  const downloadAsTxt = () => {
    const content = filteredWords.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName ? fileName.replace('.pdf', '.txt') : 'vocabulary.txt';
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
        <input
          type="file"
          accept=".pdf"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
          id="pdf-upload"
        />
        <label
          htmlFor="pdf-upload"
          style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'inline-block'
          }}
        >
          {isLoading ? '處理中...' : '選擇 PDF 檔案'}
        </label>
        {fileName && (
          <p style={{ marginTop: '10px', color: '#666' }}>
            已上傳：{fileName}
          </p>
        )}
      </div>

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
            </p>
          </div>

          {/* 單字列表 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '10px'
          }}>
            {filteredWords.map((word, index) => (
              <div
                key={index}
                style={{
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f9f9f9',
                  wordBreak: 'break-word'
                }}
              >
                {word}
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

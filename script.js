// 금지어와 허용 영어단어 저장 변수
let forbiddenWords = [];
let allowedEnglishWords = [];

// Google Sheets CSV URL
const SHEET_ID = '1HPZs_EOAlW9DBbfdw_b2dZdGiRsXSeFgg3XRKy3ITT8';
const SHEET_NAME = '풍문';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;

// DOM 요소들
const originalTextarea = document.getElementById('originalText');
const modifiedDiv = document.getElementById('modifiedText');
const originalBytesSpan = document.getElementById('originalBytes');
const modifiedBytesSpan = document.getElementById('modifiedBytes');
const statusContent = document.getElementById('statusContent');
const copyButton = document.getElementById('copyButton');
const resetButton = document.getElementById('resetButton');

// 초기화
window.addEventListener('DOMContentLoaded', () => {
    loadForbiddenAndAllowedWords();
    
    originalTextarea.addEventListener('input', handleTextInput);
    modifiedDiv.addEventListener('input', handleModifiedTextInput);
    copyButton.addEventListener('click', copyModifiedText);
    resetButton.addEventListener('click', resetAll);
});

// Google Sheets에서 금지어와 허용 영어단어 로드
async function loadForbiddenAndAllowedWords() {
    try {
        const response = await fetch(CSV_URL);
        const text = await response.text();
        
        // CSV 파싱
        const rows = text.split('\n').slice(1); // 헤더 제외
        
        rows.forEach(row => {
            // CSV 파싱 (쉼표로 구분되어 있을 수 있으므로 주의)
            const match = row.match(/^"([^"]*)","([^"]*)"$|^([^,]*),(.*)$/);
            if (match) {
                const forbidden = match[1] || match[3] || '';
                const allowed = match[2] || match[4] || '';
                
                if (forbidden.trim()) {
                    forbiddenWords.push(forbidden.trim());
                }
                if (allowed.trim()) {
                    allowedEnglishWords.push(allowed.trim());
                }
            }
        });
        
        console.log('금지어:', forbiddenWords);
        console.log('허용 영어단어:', allowedEnglishWords);
    } catch (error) {
        console.error('데이터 로드 실패:', error);
        // 기본값 설정 (예시)
        forbiddenWords = ['풍문', '최고', '최상', '완벽'];
        allowedEnglishWords = ['STEAM', 'AI', 'SW', 'ICT', 'IoT', 'IT'];
    }
}

// 텍스트 입력 처리
function handleTextInput() {
    const originalText = originalTextarea.value;
    updateByteCount(originalText, originalBytesSpan);
    
    if (!originalText) {
        modifiedDiv.innerHTML = '';
        updateByteCount('', modifiedBytesSpan);
        showEmptyStatus();
        return;
    }
    
    const { modifiedText, modifications } = processText(originalText);
    displayModifiedText(modifiedText, modifications);
    updateStatus(modifications);
}

// 수정된 텍스트 입력 처리
function handleModifiedTextInput() {
    const modifiedText = modifiedDiv.textContent;
    updateByteCount(modifiedText, modifiedBytesSpan);
    
    // 수정된 텍스트에서 문제 재검사
    const issues = checkRemainingIssues(modifiedText);
    updateModifiedHighlights(issues);
}

// 텍스트 처리
function processText(text) {
    const modifications = [];
    let modifiedText = text;
    
    // 1. 스마트 부호 변환
    const smartQuotes = {
        '"': '"', '"': '"', ''': "'", ''': "'",
        '–': '-', '—': '-', '…': '...', '•': '·'
    };
    
    for (const [smart, normal] of Object.entries(smartQuotes)) {
        if (modifiedText.includes(smart)) {
            const regex = new RegExp(smart, 'g');
            const matches = [...modifiedText.matchAll(regex)];
            if (matches.length > 0) {
                modifications.push({
                    type: 'smart-quote',
                    message: `스마트 부호 '${smart}'를 일반 부호 '${normal}'로 변환 (${matches.length}개)`,
                    positions: matches.map(m => m.index)
                });
                modifiedText = modifiedText.replace(regex, normal);
            }
        }
    }
    
    // 2. 두 칸 이상의 공백을 한 칸으로
    const spaceRegex = / {2,}/g;
    const spaceMatches = [...modifiedText.matchAll(spaceRegex)];
    if (spaceMatches.length > 0) {
        modifications.push({
            type: 'space',
            message: `두 칸 이상의 공백을 한 칸으로 변환 (${spaceMatches.length}개)`,
            positions: spaceMatches.map(m => m.index)
        });
        modifiedText = modifiedText.replace(spaceRegex, ' ');
    }
    
    // 3. 날짜 형식 검사
    const dateRegex = /\([0-9.,\-\/\s]+\)/g;
    const dateMatches = [...modifiedText.matchAll(dateRegex)];
    dateMatches.forEach(match => {
        const dateStr = match[0];
        const correctFormat = /^\(\d{4}\.\d{2}\.\d{2}\.\)$/;
        const correctFormatWithHours = /^\(\d{4}\.\d{2}\.\d{2}\.\/\d+시간\)$/;
        const correctFormatRange = /^\(\d{4}\.\d{2}\.\d{2}\.-\d{4}\.\d{2}\.\d{2}\.\)$/;
        
        if (!correctFormat.test(dateStr) && !correctFormatWithHours.test(dateStr) && !correctFormatRange.test(dateStr)) {
            modifications.push({
                type: 'date-error',
                message: `날짜 형식 오류: ${dateStr} → (YYYY.MM.DD.) 형식으로 수정 필요`,
                position: match.index,
                original: dateStr
            });
        }
    });
    
    // 4. 문장 끝 마침표 검사
    const sentences = modifiedText.split(/[.!?]\s+/);
    const lastSentence = sentences[sentences.length - 1].trim();
    if (lastSentence && !lastSentence.match(/[.!?]$/)) {
        modifications.push({
            type: 'period',
            message: '문장 끝에 마침표가 없습니다.',
            position: modifiedText.length
        });
    }
    
    // 5. 영어 사용 검사
    const englishRegex = /[a-zA-Z]+/g;
    const englishMatches = [...modifiedText.matchAll(englishRegex)];
    const nonAllowedEnglish = [];
    const allowedEnglishFound = [];
    
    englishMatches.forEach(match => {
        const word = match[0];
        if (allowedEnglishWords.includes(word)) {
            allowedEnglishFound.push({
                word: word,
                position: match.index
            });
        } else {
            nonAllowedEnglish.push({
                word: word,
                position: match.index
            });
        }
    });
    
    if (nonAllowedEnglish.length > 0) {
        modifications.push({
            type: 'english',
            message: '영어는 한글로 바꾸거나 읽히는 대로 한글로 적어서 사용하는 것을 권장합니다.',
            words: nonAllowedEnglish
        });
    }
    
    if (allowedEnglishFound.length > 0) {
        modifications.push({
            type: 'allowed-english',
            message: `허용된 영어단어 사용: ${allowedEnglishFound.map(e => e.word).join(', ')}`,
            words: allowedEnglishFound
        });
    }
    
    // 6. 금지어 검사
    const foundForbiddenWords = [];
    forbiddenWords.forEach(forbidden => {
        const regex = new RegExp(forbidden, 'g');
        const matches = [...modifiedText.matchAll(regex)];
        matches.forEach(match => {
            foundForbiddenWords.push({
                word: forbidden,
                position: match.index
            });
        });
    });
    
    if (foundForbiddenWords.length > 0) {
        modifications.push({
            type: 'forbidden',
            message: `금지어 발견: ${[...new Set(foundForbiddenWords.map(f => f.word))].join(', ')}`,
            words: foundForbiddenWords
        });
    }
    
    return { modifiedText, modifications };
}

// 수정된 텍스트 표시
function displayModifiedText(text, modifications) {
    let htmlText = text;
    const highlights = [];
    
    // 모든 하이라이트 위치 수집
    modifications.forEach(mod => {
        if (mod.type === 'forbidden' && mod.words) {
            mod.words.forEach(w => {
                highlights.push({
                    start: w.position,
                    end: w.position + w.word.length,
                    class: 'highlight-forbidden',
                    type: 'forbidden'
                });
            });
        } else if (mod.type === 'allowed-english' && mod.words) {
            mod.words.forEach(w => {
                highlights.push({
                    start: w.position,
                    end: w.position + w.word.length,
                    class: 'highlight-allowed',
                    type: 'allowed'
                });
            });
        } else if (mod.type === 'date-error' && mod.position !== undefined) {
            highlights.push({
                start: mod.position,
                end: mod.position + mod.original.length,
                class: 'highlight-date-error',
                type: 'date'
            });
        }
    });
    
    // 하이라이트 적용
    if (highlights.length > 0) {
        // 위치별로 정렬 (뒤에서부터 처리)
        highlights.sort((a, b) => b.start - a.start);
        
        highlights.forEach(h => {
            const before = htmlText.slice(0, h.start);
            const highlighted = htmlText.slice(h.start, h.end);
            const after = htmlText.slice(h.end);
            htmlText = before + `<span class="${h.class}">${highlighted}</span>` + after;
        });
    }
    
    modifiedDiv.innerHTML = htmlText;
    updateByteCount(text, modifiedBytesSpan);
}

// 수정된 텍스트의 하이라이트 업데이트
function updateModifiedHighlights(issues) {
    let text = modifiedDiv.textContent;
    let htmlText = text;
    const highlights = [];
    
    // 현재 텍스트에서 문제 재검사
    issues.forEach(issue => {
        if (issue.type === 'forbidden') {
            highlights.push({
                start: issue.position,
                end: issue.position + issue.word.length,
                class: 'highlight-forbidden'
            });
        } else if (issue.type === 'allowed') {
            highlights.push({
                start: issue.position,
                end: issue.position + issue.word.length,
                class: 'highlight-allowed'
            });
        } else if (issue.type === 'date') {
            highlights.push({
                start: issue.position,
                end: issue.position + issue.text.length,
                class: 'highlight-date-error'
            });
        }
    });
    
    // 하이라이트 적용
    if (highlights.length > 0) {
        highlights.sort((a, b) => b.start - a.start);
        
        highlights.forEach(h => {
            const before = htmlText.slice(0, h.start);
            const highlighted = htmlText.slice(h.start, h.end);
            const after = htmlText.slice(h.end);
            htmlText = before + `<span class="${h.class}">${highlighted}</span>` + after;
        });
    }
    
    // 커서 위치 저장
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const startOffset = range.startOffset;
    const startContainer = range.startContainer;
    
    modifiedDiv.innerHTML = htmlText;
    
    // 커서 위치 복원 시도
    try {
        const newRange = document.createRange();
        newRange.setStart(startContainer, startOffset);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    } catch (e) {
        // 커서 복원 실패 시 무시
    }
}

// 남은 문제 검사
function checkRemainingIssues(text) {
    const issues = [];
    
    // 금지어 재검사
    forbiddenWords.forEach(forbidden => {
        const regex = new RegExp(forbidden, 'g');
        const matches = [...text.matchAll(regex)];
        matches.forEach(match => {
            issues.push({
                type: 'forbidden',
                word: forbidden,
                position: match.index
            });
        });
    });
    
    // 허용 영어단어 재검사
    const englishRegex = /[a-zA-Z]+/g;
    const englishMatches = [...text.matchAll(englishRegex)];
    englishMatches.forEach(match => {
        const word = match[0];
        if (allowedEnglishWords.includes(word)) {
            issues.push({
                type: 'allowed',
                word: word,
                position: match.index
            });
        }
    });
    
    // 날짜 형식 재검사
    const dateRegex = /\([0-9.,\-\/\s]+\)/g;
    const dateMatches = [...text.matchAll(dateRegex)];
    dateMatches.forEach(match => {
        const dateStr = match[0];
        const correctFormat = /^\(\d{4}\.\d{2}\.\d{2}\.\)$/;
        const correctFormatWithHours = /^\(\d{4}\.\d{2}\.\d{2}\.\/\d+시간\)$/;
        const correctFormatRange = /^\(\d{4}\.\d{2}\.\d{2}\.-\d{4}\.\d{2}\.\d{2}\.\)$/;
        
        if (!correctFormat.test(dateStr) && !correctFormatWithHours.test(dateStr) && !correctFormatRange.test(dateStr)) {
            issues.push({
                type: 'date',
                text: dateStr,
                position: match.index
            });
        }
    });
    
    return issues;
}

// 상태 업데이트
function updateStatus(modifications) {
    statusContent.innerHTML = '';
    
    if (modifications.length === 0) {
        statusContent.innerHTML = '<p class="status-empty">수정 사항이 없습니다.</p>';
        return;
    }
    
    modifications.forEach(mod => {
        const item = document.createElement('div');
        item.className = 'status-item';
        
        if (mod.type === 'forbidden') {
            item.className += ' warning';
            item.innerHTML = `⚠️ ${mod.message}<br><small>※ 금지어라고 해서 무조건 못 쓰는 것은 아닙니다.</small>`;
        } else if (mod.type === 'english') {
            item.className += ' warning';
            item.textContent = `⚠️ ${mod.message}`;
        } else if (mod.type === 'date-error') {
            item.className += ' warning';
            item.textContent = `⚠️ ${mod.message}`;
        } else if (mod.type === 'period') {
            item.className += ' warning';
            item.textContent = `⚠️ ${mod.message}`;
        } else if (mod.type === 'allowed-english') {
            item.className += ' success';
            item.textContent = `✓ ${mod.message}`;
        } else if (mod.type === 'smart-quote' || mod.type === 'space') {
            item.className += ' info';
            item.textContent = `✓ ${mod.message}`;
        }
        
        statusContent.appendChild(item);
    });
}

// 빈 상태 표시
function showEmptyStatus() {
    statusContent.innerHTML = '<p class="status-empty">텍스트를 입력하면 수정 내역이 표시됩니다.</p>';
}

// 바이트 수 계산 및 업데이트
function updateByteCount(text, element) {
    const bytes = new Blob([text]).size;
    element.textContent = bytes.toLocaleString();
}

// 수정된 내용 복사
function copyModifiedText() {
    const text = modifiedDiv.textContent;
    if (!text) {
        alert('복사할 내용이 없습니다.');
        return;
    }
    
    navigator.clipboard.writeText(text).then(() => {
        copyButton.textContent = '복사 완료!';
        copyButton.style.backgroundColor = '#27ae60';
        
        setTimeout(() => {
            copyButton.textContent = '수정된 내용 복사';
            copyButton.style.backgroundColor = '#3498db';
        }, 2000);
    }).catch(err => {
        alert('복사에 실패했습니다.');
        console.error('복사 실패:', err);
    });
}

// 전체 리셋
function resetAll() {
    originalTextarea.value = '';
    modifiedDiv.innerHTML = '';
    originalBytesSpan.textContent = '0';
    modifiedBytesSpan.textContent = '0';
    showEmptyStatus();
}
# vendor (CDN 없이 같이 배포)

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `pdf-lib.min.js` | pdf-lib 1.17.1 | MIT (`pdf-lib-LICENSE.md`) |
| `fontkit.umd.min.js` | @pdf-lib/fontkit 1.1.1 | MIT |
| `html2canvas.min.js` | html2canvas 1.4.1 | MIT (`html2canvas-LICENSE.txt`) |
| `Pretendard-*-subset.ttf` | Pretendard 1.3.9 가변 글꼴을 400/700 으로 고정 후 KS X 1001 한글 2,350자 + 영숫자·기호만 남긴 서브셋 (묶음 PDF 한글 표시용) | SIL OFL 1.1 (`Pretendard-LICENSE.txt`) — 서브셋도 같은 라이선스 |

글꼴은 묶음 PDF를 만들 때만 내려받습니다(`funnel/pdf.js`).

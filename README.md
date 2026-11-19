# Statistical Report Workspace

**Created by Jan Armel Java Ajeno.**

Turn Excel, CSV, JSON, and PDF files into corrected, interactive statistical reports. There is no login and no server. Files are processed in the browser and never leave the device.

## What it does

| Area | Features |
|---|---|
| **Import** | One drop zone for `.xlsx`, `.xls`, `.xlsb`, `.ods`, `.csv`, `.json`, `.pdf`, and tables inside Word (`.docx`), PowerPoint (`.pptx`), and saved web pages (`.html`). PDF table detection and OCR for scanned PDFs. Files with the same headers are combined automatically; MSWD patient responses open the MSWD performance report. |
| **Video studio** | Turns a report into an MP4 with scenes, a written script, captions, music, animated presenter, transitions, recorded voice, and landscape, portrait, or square formats. |
| **AI analyst** | Opens with every automatic report: a written summary, a significance-tested trend (Mann-Kendall), a three-period forecast with a 95% range and backtest error, the strongest drivers (ANOVA, chi-square), unusual periods, risks, recommended actions, and a confidence level. Also added to Excel (AI Summary sheet) and PowerPoint. Worked out on the device; no data leaves it. |
| **Animated presentations** | Present mode opens with AI story slides (title, summary, key figures that count up, forecast chart that draws itself, findings), then the report pages, then the AI's recommended actions, with autoplay and a progress bar. |
| **Report assistant** | A built-in assistant answers questions, explains changes, creates charts, and suggests improvements. It runs on the device and learns only from the current report. |
| **MSWD performance report** | Turns the NEW and OLD patient form responses, monthly files, or an existing MSWD workbook into the MSWD performance workbook: DASHBOARD, DATA CHECKS, MSWD PERFORMANCE (patients catered per RSW for each month and overall, by type of patient, classification, place-name misspellings, and new or old patient), WORKER REPORT, MASTER DATA, and one sheet per month. Every number is a live Excel formula, saved with its value, and the finished file is reopened and checked before download. |
| **Combine files** | Stacks two or more files, lines up matching headers, keeps columns found in only one file, and checks every value in the finished workbook. |
| **Automatic report** | Turn on the home page switch to skip the review step. Errors are corrected and the finished report opens right after upload, with a summary of what changed. |
| **Computation audit** | Finds and corrects wrong row calculations, spreadsheet errors such as `#DIV/0!`, wrong printed totals, total rows mixed into data, duplicates, numbers stored as text, and inconsistent labels. Every correction can be reviewed and switched off. |
| **Analysis** | Distributions, correlations, outliers, trend tests, seasonality, written findings, and a "how this was calculated" view for each finding. |
| **Workspace** | Bento dashboard, cross-filtering and highlighting, slicers, drill-down, drill-through, hierarchies, a fields pane with Axis, Values, Legend, Tooltips, and Small Multiples, bookmarks, and multiple pages. |
| **Measures** | A DAX-style formula bar with percent of total, running totals, moving averages, year over year, conditional ratios, and what-if parameters. |
| **Statistics** | Descriptive statistics, period growth, segmentation, anomaly detection, regression, A/B tests, t-test, ANOVA, Mann-Whitney, Kruskal-Wallis, chi-square, confidence intervals, and forecasting. |
| **Data control** | Outlier cleaning, validation rules, count and amount classification, and a full audit trail. |
| **Protected reports** | Encrypted report files with separate owner and viewer passcodes. The viewer copy has personal columns removed. |
| **Downloads** | Excel, Google Sheets, PDF, animated PowerPoint with speaker notes, MP4 video, PNG, CSV, and a project file. Workbooks are re-opened and checked before they are offered for download. |

## Run it on your computer

Install [Node.js](https://nodejs.org) 22 or newer, then run:

```powershell
npm ci
```

```powershell
npm run dev
```

Open the address shown in the terminal.

## Publish it on GitHub Pages

1. Create a new **public** repository on GitHub.
2. Upload this folder to the repository's `main` branch. Do not upload `node_modules` or `dist`.
3. Open **Settings > Pages**.
4. Under **Build and deployment > Source**, choose **GitHub Actions**.
5. Open the **Actions** tab and wait for **Deploy to GitHub Pages** to finish.
6. Visit `https://<your-username>.github.io/<repository-name>/`.

With Git installed, these commands upload the folder after you replace the address:

```powershell
git init -b main
```

```powershell
git add .
```

```powershell
git commit -m "Initial release"
```

```powershell
git remote add origin https://github.com/<your-username>/<repository-name>.git
```

```powershell
git push -u origin main
```

## Opening a report in Google Sheets

Google Sheets files can only be created inside a Google account, and this app has no login. The **Google Sheets** download creates a compatible workbook. In Google Sheets, choose **File > Import > Upload**, then select the file.

## How calculations are checked

| Command | What it checks |
|---|---|
| `npm test` | Compares statistics, aggregations, and measures with reference answers from NumPy, SciPy, and pandas in `tests/golden/`. Also tests the audit, importers, and workbook builder. |
| `npm run lint` | Type-checks all code and rejects unused code. |

To regenerate the reference answers, install `numpy`, `scipy`, and `pandas`, then run `python tests/golden/make_golden.py`.

## Known limits

- Very large reports depend on the memory available to the browser.
- Excel limits a sheet to 1,048,576 rows and Google Sheets limits a file to 10 million cells. Larger downloads are cut off and say so in the file.
- Complex PDF layouts and poor scans can need manual review. OCR reads English text.
- Charts and pictures inside Word and PowerPoint files cannot be read; only their tables are.
- The AI analyst and MSWD AI summary are calculations with stated tests, not a chatbot. Their forecasts need at least 6 complete periods.
- The audit assumes a calculated column's inputs are right when a row disagrees with the formula that the rest of the column follows.
- The interface is available in English.
- Exported videos include captions, music, and voices you record. The read-aloud voice plays only in the preview, because browsers cannot save it into a file.
- The report assistant answers from calculations and rules on the device. It is not a general chatbot.
- MP4 export needs a current version of Chrome or Edge.

## Project layout

```text
src/core/      Calculations, audit, measures, and report queries
src/ingest/    File readers and PDF table detection
src/export/    Excel, Google Sheets, PDF, PowerPoint, PNG, and CSV output
src/state/     App state and browser storage
src/ui/        Home page, data preparation, and report workspace
tests/         Automated tests and independent reference answers
docs/PLAN.md   Original project plan
```

## Security and privacy

- Files are processed in the browser and are never uploaded.
- The site is blocked from connecting to other websites, and it has no analytics or accounts.
- Saved reports are encrypted with AES-256. Private mode keeps them off the device entirely.
- Other websites cannot embed this site.

Downloaded files are ordinary files, so store and share them carefully.

## License

Copyright (c) 2026 Jan Armel Java Ajeno. All rights reserved. See [LICENSE](LICENSE).

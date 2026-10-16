"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultInput,
  diagnose,
  type MortgageInput,
  validateInput,
} from "@/lib/mortgage";
import { clearEncryptedStorage, decryptBackup, encryptBackup, readEncrypted, storeEncrypted } from "@/lib/storage";

type SavedDiagnosis = { id: string; createdAt: string; input: MortgageInput };
type Screen = "home" | "input" | "result" | "history" | "settings";
type Field = keyof MortgageInput;

const HISTORY_KEY = "mld:history";
const DRAFT_KEY = "mld:draft";
const householdOptions = ["単身", "夫婦", "夫婦+子1人", "夫婦+子2人", "夫婦+子3人以上", "その他"] as const;
const tenureOptions = ["1年未満", "1-3年", "3-5年", "5-10年", "10年以上"] as const;
const yearOptions = [10, 15, 20, 25, 30, 35];
const yenFormat = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const formatYen = (value: number) => yenFormat.format(value);
const formatMan = (value: number) => `${(value / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`;
const createId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export default function Home() {
  const [screen, setScreenState] = useState<Screen>("home");
  const [input, setInput] = useState<MortgageInput>(defaultInput);
  const [history, setHistory] = useState<SavedDiagnosis[]>([]);
  const [selected, setSelected] = useState<SavedDiagnosis | null>(null);
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [historyName, setHistoryName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const draftRevision = useRef(0);

  const diagnosis = useMemo(() => diagnose(input), [input]);
  const errors = useMemo(() => validateInput(input), [input]);
  const activeInput = selected?.input ?? input;
  const activeDiagnosis = useMemo(() => diagnose(activeInput), [activeInput]);
  const activeMemo = selected?.input.memo ?? input.memo;
  const overallLevel = Math.max(...activeDiagnosis.scenarios.map((scenario) => scenario.judgementLevel));

  useEffect(() => {
    let mounted = true;
    const revision = draftRevision.current;
    async function restore() {
      try {
        const savedHistory = await readEncrypted<SavedDiagnosis[]>(HISTORY_KEY);
        const draft = await readEncrypted<MortgageInput>(DRAFT_KEY);
        if (!mounted) return;
        if (savedHistory) setHistory(savedHistory.slice(0, 10));
        if (draft && draftRevision.current === revision) setInput({ ...defaultInput(), ...draft });
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? `保存データを読み込めませんでした。${cause.message}` : "保存データを読み込めませんでした。");
      } finally {
        if (mounted) setHydrated(true);
      }
    }
    void restore();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const revision = ++draftRevision.current;
    const timeout = window.setTimeout(() => {
      storeEncrypted(DRAFT_KEY, input, () => draftRevision.current === revision).catch((cause: unknown) => {
        setError(cause instanceof Error ? `下書きを保存できませんでした。${cause.message}` : "下書きを保存できませんでした。");
      });
    }, 500);
    return () => {
      window.clearTimeout(timeout);
      if (draftRevision.current === revision) draftRevision.current += 1;
    };
  }, [input, hydrated]);

  function update<K extends Field>(field: K, value: MortgageInput[K]) {
    setInput((current) => ({ ...current, [field]: value }));
    setSelected(null);
  }

  function setScreen(nextScreen: Screen) {
    if (nextScreen !== "result") setSaveNotice("");
    setScreenState(nextScreen);
  }

  function startNewDiagnosis() {
    draftRevision.current += 1;
    setInput(defaultInput());
    setSelected(null);
    setStep(0);
    setShowSchedule(false);
    setScreen("input");
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (cause) {
      setError(cause instanceof Error ? `以前の下書きを削除できませんでした。${cause.message}` : "以前の下書きを削除できませんでした。");
    }
  }

  function setNumeric(field: Exclude<Field, "household" | "tenure" | "memo">, raw: string) {
    const value = raw === "" ? 0 : Number(raw);
    setInput((current) => ({ ...current, [field]: value }));
    setSelected(null);
  }

  async function persistHistory(records: SavedDiagnosis[]) {
    await storeEncrypted(HISTORY_KEY, records);
    setHistory(records);
  }

  async function saveDiagnosis() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (Object.keys(errors).length > 0) {
      setError("入力内容を確認してください。");
      setScreen("input");
      return;
    }
    if (history.length >= 10 && !window.confirm("履歴は最大10件です。最も古い履歴を削除して保存しますか？")) return;
    setHistoryName(input.memo);
    setSaveError("");
    setShowSaveDialog(true);
  }

  async function confirmSaveDiagnosis() {
    const memo = historyName.trim();
    if (!memo) {
      setSaveError("履歴に表示する名前を入力してください。");
      return;
    }
    if (memo.length > 20) {
      setSaveError("履歴名は20文字以内で入力してください。");
      return;
    }
    if (saving) return;
    const recordInput = { ...input, memo };
    const record: SavedDiagnosis = { id: createId(), createdAt: new Date().toISOString(), input: recordInput };
    setSaving(true);
    try {
      await persistHistory([record, ...history].slice(0, 10));
      setInput(recordInput);
      setSaveNotice("診断結果をこの端末に暗号化して保存しました。");
      setSelected(record);
      setShowSaveDialog(false);
    } catch (cause) {
      setError(cause instanceof Error ? `履歴を保存できませんでした。${cause.message}` : "履歴を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  function openRecord(record: SavedDiagnosis) {
    setSelected(record);
    setScreen("result");
    setShowSchedule(false);
  }

  function advanceStep() {
    setStep((current) => current + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showDiagnosisResult() {
    setSelected(null);
    setShowSchedule(false);
    setScreen("result");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteRecord(id: string) {
    if (!window.confirm("この診断履歴を削除しますか？")) return;
    try {
      await persistHistory(history.filter((record) => record.id !== id));
      setNotice("履歴を削除しました。");
    } catch (cause) {
      setError(cause instanceof Error ? `履歴を削除できませんでした。${cause.message}` : "履歴を削除できませんでした。");
    }
  }

  async function clearAll() {
    if (!window.confirm("この端末に保存した履歴と入力内容をすべて削除しますか？この操作は取り消せません。")) return;
    try {
      await clearEncryptedStorage([HISTORY_KEY, DRAFT_KEY]);
      setHistory([]);
      setInput(defaultInput());
      setSelected(null);
      setNotice("この端末に保存されたデータを削除しました。");
    } catch (cause) {
      setError(cause instanceof Error ? `データを完全削除できませんでした。${cause.message}` : "データを完全削除できませんでした。");
    }
  }

  async function exportHistory() {
    try {
      const passphrase = window.prompt("バックアップを暗号化するパスフレーズを入力してください（8文字以上）。");
      if (passphrase === null) return;
      if (passphrase.length < 8) throw new Error("パスフレーズは8文字以上にしてください。");
      const confirmation = window.prompt("確認のため、同じパスフレーズをもう一度入力してください。");
      if (confirmation === null) return;
      if (passphrase !== confirmation) throw new Error("パスフレーズが一致しません。");
      const json = await encryptBackup({ version: 1, exportedAt: new Date().toISOString(), history }, passphrase);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "mortgage-diagnosis-backup.json";
      link.click();
      URL.revokeObjectURL(url);
      setNotice("暗号化された履歴バックアップをダウンロードしました。復元時にパスフレーズが必要です。");
    } catch (cause) {
      setError(cause instanceof Error ? `バックアップを作成できませんでした。${cause.message}` : "バックアップを作成できませんでした。");
    }
  }

  async function importHistory(file: File | undefined) {
    if (!file) return;
    try {
      const passphrase = window.prompt("バックアップのパスフレーズを入力してください。");
      if (passphrase === null) return;
      const parsed: unknown = await decryptBackup(await file.text(), passphrase);
      if (!parsed || typeof parsed !== "object" || !("history" in parsed) || !Array.isArray(parsed.history)) {
        throw new Error("バックアップ形式が正しくありません。");
      }
      const imported = (parsed.history as SavedDiagnosis[]).filter(
        (item) => item && typeof item.id === "string" && typeof item.createdAt === "string" && item.input,
      );
      if (imported.length === 0) throw new Error("有効な履歴がありません。");
      if (!window.confirm(`${imported.length}件の履歴を現在の履歴に追加しますか？`)) return;
      await persistHistory([...imported, ...history].slice(0, 10));
      setNotice(`${Math.min(imported.length, 10 - history.length)}件の履歴を取り込みました（保存上限10件）。`);
    } catch (cause) {
      setError(cause instanceof Error ? `バックアップを読み込めませんでした。${cause.message}` : "バックアップを読み込めませんでした。");
    }
  }

  return (
    <main className={`app-shell${largeText ? " large-text" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => { setScreen("home"); setSelected(null); }} aria-label="ホームへ">
          <span className="brand-mark">住</span>
          <span>住まいの資金計画<span className="brand-sub">HOUSING LOAN GUIDE</span></span>
        </button>
        <nav className="topnav" aria-label="メインメニュー">
          <button className={screen === "home" ? "nav-active" : ""} onClick={() => { setScreen("home"); setSelected(null); }}>ホーム</button>
          <button className={screen === "history" ? "nav-active" : ""} onClick={() => setScreen("history")}>診断履歴 <span className="nav-count">{history.length}</span></button>
          <button className={screen === "settings" ? "nav-active" : ""} onClick={() => setScreen("settings")}>設定</button>
        </nav>
        <button className="text-size-button" onClick={() => setLargeText((value) => !value)} aria-pressed={largeText}>文字 {largeText ? "大" : "標準"}</button>
      </header>

      <div className="main-content">
        {error && <div className="alert alert-error" role="alert">{error}<button onClick={() => setError("")} aria-label="閉じる">×</button></div>}
        {notice && <div className="alert alert-success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="閉じる">×</button></div>}
        {screen === "result" && saveNotice && <div className="alert alert-success" role="status">{saveNotice}<button onClick={() => setSaveNotice("")} aria-label="閉じる">×</button></div>}
        {!hydrated && <div className="loading-note">この端末の保存データを確認しています…</div>}

        {screen === "home" && <section className="home-screen">
          <div className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><span className="status-dot" /> 展示場での資金相談を、わかりやすく</div>
              <h1>これからの暮らしに、<br /><span>ちょうどいい返済計画</span>を。</h1>
              <p>かんたんな入力で、住宅ローンの返済額や借入の目安をその場でシミュレーションできます。</p>
              <button className="button button-primary button-large" onClick={startNewDiagnosis}>
                新しい診断をはじめる <span aria-hidden="true">→</span>
              </button>
              <div className="hero-footnote">入力した情報はこの端末内で暗号化して保存されます。</div>
            </div>
            <div className="hero-visual" aria-label="住宅ローンのイメージ">
              <div className="visual-sun" />
              <div className="visual-house">
                <div className="house-roof" />
                <div className="house-body"><div className="house-window" /><div className="house-door" /><div className="house-window" /></div>
              </div>
              <div className="visual-card"><span>毎月の返済イメージ</span><strong>{formatYen(diagnosis.scenarios[0].monthlyPayment)}</strong><small>変動金利・標準金利で試算</small></div>
            </div>
          </div>
          <div className="home-grid">
            <button className="home-tile" onClick={startNewDiagnosis}>
              <span className="tile-icon">＋</span><span><strong>新規診断</strong><small>条件を入力して診断を始める</small></span><span className="tile-arrow">→</span>
            </button>
            <button className="home-tile" onClick={() => setScreen("history")}>
              <span className="tile-icon tile-icon-sand">↻</span><span><strong>履歴から再開</strong><small>{history.length ? `保存済み ${history.length}件の診断を確認` : "保存した診断はまだありません"}</small></span><span className="tile-arrow">→</span>
            </button>
          </div>
          {history.length > 0 && <section className="recent-section">
            <div className="section-heading"><div><span className="eyebrow">RECENT</span><h2>最近の診断</h2></div><button className="link-button" onClick={() => setScreen("history")}>すべて見る →</button></div>
            <div className="recent-list">{history.slice(0, 3).map((record) => (
              <button className="recent-row" key={record.id} onClick={() => openRecord(record)}>
                <span className="recent-date">{new Date(record.createdAt).toLocaleDateString("ja-JP")}</span>
                <span className="recent-memo">{record.input.memo || "名前未設定"}</span>
                <span>{record.input.price.toLocaleString()}万円</span>
                <span className="recent-arrow">→</span>
              </button>
            ))}</div>
          </section>}
          <p className="disclaimer">この診断は入力条件に基づく概算であり、融資を保証するものではありません。実際の借入条件は金融機関の審査により異なります。</p>
        </section>}

        {screen === "input" && <section className="form-screen">
          <button className="back-link" onClick={() => setScreen("home")}>← ホームに戻る</button>
          <div className="page-heading"><span className="eyebrow">LOAN SIMULATION</span><h1>診断条件を入力</h1><p>わかる範囲で入力してください。入力内容は自動でこの端末に保存されます。</p></div>
          <div className="stepper" aria-label="入力ステップ">
            {["基本情報", "希望条件", "その他借入"].map((label, index) => <button key={label} className={`stepper-step${step === index ? " step-current" : step > index ? " step-done" : ""}`} onClick={() => setStep(index)}><span>{step > index ? "✓" : index + 1}</span>{label}</button>)}
          </div>
          <div className="form-layout">
            <div className="form-card">
              {step === 0 && <div className="form-section">
                <div className="form-section-heading"><span className="section-number">01</span><div><h2>基本情報</h2><p>お客様の状況をお聞かせください。</p></div></div>
                <label className="field"><span className="field-title">年収（税込）<b>必須</b></span><span className="input-suffix"><input type="number" min="100" max="3000" step="10" inputMode="numeric" value={input.income || ""} onChange={(event) => setNumeric("income", event.target.value)} /><span>万円</span></span><small>ご本人の税込年収を入力してください。</small>{errors.income && <em>{errors.income}</em>}</label>
                <div className="field-row">
                  <label className="field"><span className="field-title">年齢<b>必須</b></span><span className="select-suffix"><select value={input.age} onChange={(event) => setNumeric("age", event.target.value)}>{Array.from({ length: 51 }, (_, index) => index + 20).map((age) => <option key={age} value={age}>{age}歳</option>)}</select><span>⌄</span></span>{errors.age && <em>{errors.age}</em>}</label>
                  <label className="field"><span className="field-title">勤続年数<b>必須</b></span><span className="select-suffix"><select value={input.tenure} onChange={(event) => update("tenure", event.target.value as MortgageInput["tenure"])}>{tenureOptions.map((option) => <option key={option}>{option}</option>)}</select><span>⌄</span></span></label>
                </div>
                <fieldset className="field"><legend className="field-title">家族構成<b>必須</b></legend><div className="choice-grid">{householdOptions.map((option) => <label className={`choice${input.household === option ? " choice-selected" : ""}`} key={option}><input type="radio" name="household" checked={input.household === option} onChange={() => update("household", option)} />{option}</label>)}</div></fieldset>
                <label className="field"><span className="field-title">お客様名・メモ <small className="optional">任意</small></span><input type="text" maxLength={20} placeholder="例：ご家族の相談メモ" value={input.memo} onChange={(event) => update("memo", event.target.value)} /><small>個人名を避けた匿名での利用をおすすめします。（20文字以内）</small></label>
              </div>}
              {step === 1 && <div className="form-section">
                <div className="form-section-heading"><span className="section-number">02</span><div><h2>希望条件</h2><p>検討中の住まいと返済の希望を入力します。</p></div></div>
                <label className="field"><span className="field-title">物件希望価格<b>必須</b></span><span className="input-suffix"><input type="text" inputMode="numeric" value={input.price ? input.price.toLocaleString("ja-JP") : ""} onChange={(event) => {
                  const target = event.currentTarget;
                  const digitsBeforeCursor = target.value.slice(0, target.selectionStart ?? target.value.length).replace(/\D/g, "").length;
                  const rawValue = target.value.replace(/\D/g, "");
                  const value = rawValue ? Number(rawValue) : 0;
                  const formattedValue = rawValue ? value.toLocaleString("ja-JP") : "";
                  setInput((current) => ({ ...current, price: value, downPayment: Math.min(current.downPayment, value * 0.5) }));
                  setSelected(null);
                  requestAnimationFrame(() => {
                    let cursor = 0;
                    let digitCount = 0;
                    while (cursor < formattedValue.length && digitCount < digitsBeforeCursor) {
                      if (/\d/.test(formattedValue[cursor])) digitCount += 1;
                      cursor += 1;
                    }
                    target.setSelectionRange(cursor, cursor);
                  });
                }} /><span>万円</span></span><input className="price-range" type="range" min="1000" max="10000" step="100" value={Math.min(10000, Math.max(1000, input.price))} onChange={(event) => {
                  const value = Number(event.target.value);
                  setInput((current) => ({ ...current, price: value, downPayment: Math.min(current.downPayment, value * 0.5) }));
                  setSelected(null);
                }} /><div className="range-ends"><span>1,000万円</span><span>1億円</span></div><div className="price-category">{input.price <= 2000 ? "手頃" : input.price <= 4000 ? "標準" : input.price <= 7000 ? "高級" : "プレミアム"}な価格帯</div>{errors.price && <em>{errors.price}</em>}</label>
                <div className="field-row">
                  <label className="field"><span className="field-title">頭金<b>必須</b></span><span className="input-suffix"><input type="number" min="0" max={input.price * 0.5} step="10" inputMode="numeric" value={input.downPayment || ""} onChange={(event) => setNumeric("downPayment", event.target.value)} /><span>万円</span></span><small>物件価格の50%まで</small>{errors.downPayment && <em>{errors.downPayment}</em>}</label>
                  <label className="field"><span className="field-title">希望返済期間<b>必須</b></span><span className="select-suffix"><select value={input.years} onChange={(event) => setNumeric("years", event.target.value)}>{yearOptions.map((year) => <option key={year} value={year}>{year}年</option>)}</select><span>⌄</span></span></label>
                </div>
                <label className="field"><span className="field-title">月々支払希望額 <small className="optional">任意</small></span><span className="input-suffix"><input type="number" min="5" max="50" step="1" inputMode="numeric" placeholder="入力しない場合は空欄" value={input.desiredMonthly} onChange={(event) => {
                  const value = event.target.value === "" ? "" : Number(event.target.value);
                  setInput((current) => ({ ...current, desiredMonthly: value }));
                  setSelected(null);
                }} /><span>万円</span></span>{errors.desiredMonthly && <em>{errors.desiredMonthly}</em>}</label>
                <div className="loan-preview"><span>借入予定額</span><strong>{formatMan(Math.max(0, input.price - input.downPayment))}</strong><small>物件価格から頭金を差し引いた金額</small></div>
                {input.age + input.years > 80 && <div className="alert alert-warning">完済時年齢が{input.age + input.years}歳となります。金融機関にご確認ください。</div>}
              </div>}
              {step === 2 && <div className="form-section">
                <div className="form-section-heading"><span className="section-number">03</span><div><h2>その他の借入</h2><p>現在返済中のお借入があれば入力してください。</p></div></div>
                <label className="field"><span className="field-title">車のローン残高 <small className="optional">任意</small></span><span className="input-suffix"><input type="number" min="0" max="1000" step="10" inputMode="numeric" value={input.carDebt} onChange={(event) => setNumeric("carDebt", event.target.value)} /><span>万円</span></span><small>月々返済額は残高の60分の1として試算します。</small>{errors.carDebt && <em>{errors.carDebt}</em>}</label>
                <label className="field"><span className="field-title">その他借入残高 <small className="optional">任意</small></span><span className="input-suffix"><input type="number" min="0" max="1000" step="10" inputMode="numeric" value={input.otherDebt} onChange={(event) => setNumeric("otherDebt", event.target.value)} /><span>万円</span></span><small>教育ローンなど、その他の借入残高を入力します。</small>{errors.otherDebt && <em>{errors.otherDebt}</em>}</label>
                <label className="field"><span className="field-title">クレジットカード月間利用額 <small className="optional">任意</small></span><span className="input-suffix"><input type="number" min="0" max="100" step="0.1" inputMode="decimal" value={input.cardSpend} onChange={(event) => setNumeric("cardSpend", event.target.value)} /><span>万円</span></span><small>利用額の15%を返済負担として試算します。</small>{errors.cardSpend && <em>{errors.cardSpend}</em>}</label>
                <div className="summary-box"><h3>入力内容の確認</h3><div><span>年収</span><strong>{input.income.toLocaleString()}万円</strong></div><div><span>物件価格・頭金</span><strong>{input.price.toLocaleString()}万円・{input.downPayment.toLocaleString()}万円</strong></div><div><span>借入予定額・期間</span><strong>{formatMan(Math.max(0, input.price - input.downPayment))}・{input.years}年</strong></div><div><span>既存借入の月額目安</span><strong>{formatYen(diagnosis.existingMonthly)}</strong></div></div>
              </div>}
              <div className="form-actions">
                <button className="button button-quiet" onClick={() => step === 0 ? setScreen("home") : setStep((value) => value - 1)}>{step === 0 ? "キャンセル" : "← 戻る"}</button>
                {step < 2 ? <button className="button button-primary" onClick={advanceStep}>次へ進む <span>→</span></button> : <button className="button button-primary" onClick={showDiagnosisResult} disabled={Object.keys(errors).length > 0}>診断結果を見る <span>→</span></button>}
              </div>
            </div>
            <aside className="estimate-card"><span className="eyebrow">QUICK ESTIMATE</span><h3>入力中の返済目安</h3><p>変動金利・標準金利の場合</p><strong>{formatYen(diagnosis.scenarios[0].monthlyPayment)}<small> / 月</small></strong><div className="estimate-line"><span>借入予定額</span><b>{formatMan(diagnosis.principal)}</b></div><div className="estimate-line"><span>返済期間</span><b>{input.years}年</b></div><div className="estimate-line"><span>適用金利（標準）</span><b>年0.7%</b></div><div className="estimate-note">金利や審査条件によって実際の返済額は異なります。</div></aside>
          </div>
        </section>}

        {screen === "result" && <section className="result-screen">
          <button className="back-link no-print" onClick={() => { setScreen("input"); setSelected(null); }}>← 条件を変更する</button>
          <div className="result-title-row"><div className="page-heading"><span className="eyebrow">YOUR SIMULATION</span><h1>診断結果</h1><p>{activeMemo ? `${activeMemo}様の診断結果` : "入力条件に基づく診断結果です"} ・ {activeInput.price.toLocaleString()}万円の物件</p></div><div className="result-buttons no-print">{selected && <button className="button button-secondary" onClick={() => { setSelected(null); setScreen("input"); }}>条件を変更</button>}<button className="button button-secondary" onClick={() => window.print()}>印刷・PDF</button>{!selected && <button className="button button-primary" onClick={() => void saveDiagnosis()}>この結果を保存</button>}</div></div>
          {activeDiagnosis.warnings.map((warning) => <div className="alert alert-warning" key={warning}>注意：{warning}</div>)}
          <div className="overall-card">
            <div className={`judgement-symbol judgement-${overallLevel}`}>{["○", "△", "×"][overallLevel]}</div>
            <div><span className="eyebrow">総合判定（最も厳しい条件）</span><h2>{activeDiagnosis.scenarios.find((scenario) => scenario.judgementLevel === overallLevel)?.judgement}</h2><p>{["返済計画として検討しやすい目安です。", "頭金や返済期間など、条件の見直しもご検討ください。", "物件価格や借入条件の大幅な見直しをおすすめします。"][overallLevel]}</p></div>
            <div className="overall-stat"><span>標準変動金利での返済比率</span><strong>{activeDiagnosis.scenarios[0].repaymentRatio.toFixed(1)}%</strong><small>既存借入を含む</small></div>
          </div>
          <div className="metric-grid">
            <div className="metric-card"><span>借入予定額</span><strong>{formatMan(activeDiagnosis.principal)}</strong><small>物件価格 − 頭金</small></div>
            <div className="metric-card"><span>諸費用の概算</span><strong>{formatYen(activeDiagnosis.fees.total)}</strong><small>物件価格の約{(activeDiagnosis.fees.total / Math.max(1, activeInput.price * 10_000) * 100).toFixed(1)}%</small></div>
            <div className="metric-card"><span>完済時年齢</span><strong>{activeDiagnosis.completionAge}歳</strong><small>{activeInput.years}年返済の場合</small></div>
          </div>
          <div className="section-heading result-section-heading"><div><span className="eyebrow">LOAN OPTIONS</span><h2>金利タイプを比較</h2></div><span className="muted-caption">金利は標準値で試算</span></div>
          <div className="scenario-grid">{activeDiagnosis.scenarios.map((scenario, index) => (
            <article className={`scenario-card${index === 0 ? " scenario-recommended" : ""}`} key={scenario.name}>
              {index === 0 && <span className="recommended-tag">おすすめの目安</span>}
              <span className="scenario-name">{scenario.name}</span><span className="scenario-rate">年 {scenario.rate.toFixed(1)}% <small>（{scenario.rateRange}）</small></span>
              <span className="scenario-monthly">{formatYen(scenario.monthlyPayment)}<small> / 月</small></span>
              <div className="scenario-bar"><span style={{ width: `${Math.max(8, (scenario.monthlyPayment / Math.max(...activeDiagnosis.scenarios.map((entry) => entry.monthlyPayment), 1)) * 100)}%` }} /></div>
              <div className="scenario-detail"><span>返済比率<small>既存借入込み</small></span><b>{scenario.repaymentRatio.toFixed(1)}%</b></div>
              <div className="scenario-detail"><span>返済総額</span><b>{formatYen(scenario.totalPayment)}</b></div>
              <div className="scenario-detail"><span>うち利息</span><b>{formatYen(scenario.interest)}</b></div>
              <div className="scenario-detail"><span>適正判定</span><b className={`judgement-label label-${scenario.judgementLevel}`}>{["○", "△", "×"][scenario.judgementLevel]} {scenario.judgement}</b></div>
              {scenario.name === "固定10年" && <small className="scenario-footnote">11年目以降は年1.5%で再計算</small>}
            </article>
          ))}</div>
          <div className="detail-grid">
            <section className="detail-card"><div className="detail-title"><div><span className="eyebrow">BORROWING GUIDE</span><h2>借入可能額の目安</h2></div></div><p className="detail-intro">年収倍率と返済比率から算出した参考値です（審査金利 年3.5%）。</p>
              {activeDiagnosis.borrowing.map((item) => <div className="borrowing-row" key={item.name}><span>{item.name}プラン</span><strong>{formatYen(item.amount)}</strong><small>物件価格の目安 {formatYen(item.propertyPrice)}</small></div>)}
            </section>
            <section className="detail-card"><div className="detail-title"><div><span className="eyebrow">INITIAL COST</span><h2>諸費用の内訳</h2></div></div>
              <div className="fee-row"><span>登記費用（物件価格の0.5%）</span><b>{formatYen(activeDiagnosis.fees.registration)}</b></div><div className="fee-row"><span>融資手数料（借入額の2.2%）</span><b>{formatYen(activeDiagnosis.fees.loanFee)}</b></div><div className="fee-row"><span>火災保険（35年定額）</span><b>{formatYen(activeDiagnosis.fees.insurance)}</b></div><div className="fee-row"><span>印紙税・その他（0.3%）</span><b>{formatYen(activeDiagnosis.fees.stamp)}</b></div><div className="fee-row fee-total"><span>合計（概算）</span><b>{formatYen(activeDiagnosis.fees.total)}</b></div><p className="detail-intro">諸費用は現金でお支払いいただく想定です。団体信用生命保険料は金利に含みます。</p>
            </section>
          </div>
          <section className="detail-card schedule-card"><button className="schedule-toggle" onClick={() => setShowSchedule((value) => !value)} aria-expanded={showSchedule}><span><span className="eyebrow">REPAYMENT SCHEDULE</span><strong>年次返済表（変動金利・標準金利）</strong></span><span>{showSchedule ? "閉じる −" : "表示する ＋"}</span></button>
            {showSchedule && <div className="table-scroll"><table><thead><tr><th>経過年数</th><th>年間返済額</th><th>元本返済額</th><th>利息支払額</th><th>返済残高</th><th>累計利息</th></tr></thead><tbody>{activeDiagnosis.scenarios[0].schedule.map((row) => <tr key={row.year}><td>{row.year}年目</td><td>{formatYen(row.payment)}</td><td>{formatYen(row.principal)}</td><td>{formatYen(row.interest)}</td><td>{formatYen(row.balance)}</td><td>{formatYen(row.cumulativeInterest)}</td></tr>)}</tbody></table></div>}
          </section>
          <div className="disclaimer-box"><strong>ご利用にあたって</strong><p>この結果は入力された情報に基づく概算であり、借入可能額や融資の承認を保証するものではありません。実際の金利・返済額・諸費用は金融機関や商品、審査結果により異なります。正式な条件は各金融機関へご確認ください。</p></div>
          <div className="result-footer-actions no-print"><button className="button button-secondary" onClick={() => setScreen("history")}>履歴を見る</button><button className="button button-secondary" onClick={() => { setSelected(null); setScreen("home"); }}>ホームへ戻る</button><button className="button button-primary" onClick={startNewDiagnosis}>別の条件で診断する</button></div>
        </section>}

        {screen === "history" && <section className="history-screen">
          <div className="page-heading"><span className="eyebrow">SAVED DIAGNOSES</span><h1>診断履歴</h1><p>保存した診断結果は、この端末内だけに暗号化して保管されます。</p></div>
          <div className="history-toolbar"><span>{history.length} / 10 件を保存中</span><div><button className="button button-secondary" onClick={() => void exportHistory()} disabled={!history.length}>バックアップを書き出す</button><label className="button button-secondary file-button">バックアップを読み込む<input type="file" accept="application/json,.json" onChange={(event) => { void importHistory(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div></div>
          {history.length === 0 ? <div className="empty-state"><span className="empty-icon">⌂</span><h2>保存された診断はありません</h2><p>診断結果画面の「この結果を保存」から保存できます。</p><button className="button button-primary" onClick={startNewDiagnosis}>新しい診断をはじめる</button></div> :
            <div className="history-list">{history.map((record) => {
              const result = diagnose(record.input).scenarios[0];
              return <article className="history-card" key={record.id}><div className="history-card-main"><span className="history-date">{new Date(record.createdAt).toLocaleString("ja-JP")}</span><h2>{record.input.memo || "名前未設定"}</h2><span>{record.input.price.toLocaleString()}万円の物件 ・ {record.input.years}年返済</span></div><div className="history-card-stat"><small>変動金利・月々返済</small><strong>{formatYen(result.monthlyPayment)}</strong></div><span className={`judgement-label label-${result.judgementLevel}`}>{["○", "△", "×"][result.judgementLevel]} {result.judgement}</span><div className="history-card-actions"><button className="link-button" onClick={() => openRecord(record)}>結果を見る →</button><button className="link-button danger-link" onClick={() => void deleteRecord(record.id)}>削除</button></div></article>;
            })}</div>}
          <p className="disclaimer">診断履歴はブラウザーのデータ削除や端末の変更で失われる場合があります。定期的にバックアップをお取りください。</p>
        </section>}

        {screen === "settings" && <section className="settings-screen">
          <div className="page-heading"><span className="eyebrow">PREFERENCES & DATA</span><h1>設定・データ管理</h1><p>このアプリの表示と、端末内データを管理します。</p></div>
          <section className="settings-card"><span className="eyebrow">DISPLAY</span><h2>表示設定</h2><div className="settings-row"><div><strong>文字サイズ</strong><small>読みやすい大きさに切り替えます。</small></div><button className="button button-secondary" onClick={() => setLargeText((value) => !value)}>{largeText ? "標準サイズに戻す" : "大きく表示する"}</button></div></section>
          <section className="settings-card"><span className="eyebrow">LOCAL DATA</span><h2>データ管理</h2><p>診断履歴はAES-GCMで暗号化して端末内に保存します。暗号鍵はIndexedDBに保管され、診断情報を外部へ送信しません。</p><div className="settings-row"><div><strong>診断履歴のバックアップ</strong><small>パスフレーズで暗号化したJSONファイルを書き出し・読み込みできます。</small></div><div><button className="button button-secondary" onClick={() => void exportHistory()} disabled={!history.length}>書き出す</button><label className="button button-secondary file-button">読み込む<input type="file" accept="application/json,.json" onChange={(event) => { void importHistory(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div></div><div className="settings-row settings-danger"><div><strong>この端末の保存データを完全削除</strong><small>履歴・下書き・暗号鍵をすべて削除します。</small></div><button className="button button-danger" onClick={() => void clearAll()}>すべて削除</button></div></section>
          <section className="settings-card"><span className="eyebrow">ABOUT</span><h2>診断について</h2><p>金利は固定値（変動0.7%、固定10年1.3%、全期間固定1.8%）を使った概算です。金融機関の正式な審査や融資条件を示すものではありません。</p><p className="version-info">住宅ローン診断ツール ・ ローカル診断版</p></section>
        </section>}
      </div>
      {showSaveDialog && <div className="dialog-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) setShowSaveDialog(false);
      }}>
        <section className="name-dialog" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title">
          <span className="eyebrow">SAVE DIAGNOSIS</span>
          <h2 id="save-dialog-title">履歴に表示する名前</h2>
          <p>保存した診断を見分けるための名前を入力してください。</p>
          <form onSubmit={(event) => { event.preventDefault(); void confirmSaveDiagnosis(); }}>
            <label className="login-label" htmlFor="history-name">名前（20文字以内）</label>
            <input id="history-name" autoFocus maxLength={20} value={historyName} onChange={(event) => {
              setHistoryName(event.target.value);
              setSaveError("");
            }} />
            {saveError && <div className="login-error" role="alert">{saveError}</div>}
            <div className="name-dialog-actions">
              <button className="button button-secondary" type="button" disabled={saving} onClick={() => setShowSaveDialog(false)}>キャンセル</button>
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? "保存しています…" : "保存する"}</button>
            </div>
          </form>
        </section>
      </div>}
      <footer className="site-footer"><span>住宅ローン診断ツール</span><span>入力データは端末内で処理・保存されます</span></footer>
    </main>
  );
}

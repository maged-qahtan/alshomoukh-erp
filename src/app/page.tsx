const modules = [
  { title: "القيود اليومية", description: "إنشاء القيود ومراجعتها وترحيلها", icon: "📒", status: "قيد التطوير" },
  { title: "دليل الحسابات", description: "شجرة الحسابات والأرصدة الافتتاحية", icon: "🗂️", status: "قيد التطوير" },
  { title: "الأستاذ العام", description: "حركة وأرصدة الحسابات بالتفصيل", icon: "📚", status: "قيد التطوير" },
  { title: "ميزان المراجعة", description: "مراجعة أرصدة المدين والدائن", icon: "⚖️", status: "قيد التطوير" },
  { title: "العملاء والموردون", description: "إدارة الذمم والأرصدة المستحقة", icon: "👥", status: "قيد التطوير" },
  { title: "الصندوق والبنوك", description: "السندات والتحويلات والتسويات", icon: "🏦", status: "قيد التطوير" },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "36px 22px 60px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 38 }}>
        <div>
          <div style={{ color: "var(--primary)", fontWeight: 700, fontSize: 14 }}>ALSHOMOUKH ERP</div>
          <h1 style={{ margin: "8px 0 4px", fontSize: 30 }}>نظام الشموخ المحاسبي</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>منصة موحدة لإدارة الحسابات والعمليات المالية</p>
        </div>
        <div style={{ background: "var(--primary-soft)", color: "var(--primary)", borderRadius: 12, padding: "10px 16px", fontWeight: 600 }}>الإصدار التأسيسي 0.1</div>
      </header>

      <section style={{ background: "var(--primary)", color: "white", borderRadius: 20, padding: 26, marginBottom: 28 }}>
        <div style={{ opacity: .8, fontSize: 14 }}>لوحة التحكم</div>
        <h2 style={{ fontSize: 23, margin: "8px 0" }}>مرحباً بك في نظام الشموخ ERP</h2>
        <p style={{ margin: 0, opacity: .85, lineHeight: 1.8 }}>هذه هي الواجهة التأسيسية. ستظهر هنا المؤشرات المالية بعد تفعيل قاعدة البيانات وترحيل الحركات المحاسبية.</p>
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21 }}>الوحدات الرئيسية</h2>
          <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 14 }}>اختر الوحدة التي تريد العمل عليها</p>
        </div>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>العملة الأساسية: SAR</span>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 15 }}>
        {modules.map((module) => (
          <article key={module.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 27 }}>{module.icon}</div>
            <h3 style={{ margin: "12px 0 5px", fontSize: 18 }}>{module.title}</h3>
            <p style={{ color: "var(--muted)", margin: "0 0 16px", fontSize: 14 }}>{module.description}</p>
            <span style={{ color: "var(--primary)", background: "var(--primary-soft)", borderRadius: 20, padding: "5px 10px", fontSize: 12 }}>{module.status}</span>
          </article>
        ))}
      </section>

      <footer style={{ borderTop: "1px solid var(--border)", marginTop: 38, paddingTop: 18, color: "var(--muted)", fontSize: 12 }}>
        نظام الشموخ ERP · أساس الاستحقاق · القيد المزدوج · SAR
      </footer>
    </main>
  );
}

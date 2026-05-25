import { Link } from "wouter";

const sections = [
  {
    title: "1. Aceite dos termos",
    body: "Ao acessar ou usar o UP Dash, o usuário declara que leu, entendeu e concorda com estes Termos de Serviço. Caso não concorde, não deve utilizar a plataforma.",
  },
  {
    title: "2. Descrição do serviço",
    body: "UP Dash é uma plataforma de dashboard, inteligência operacional e atendimento que permite visualizar indicadores, relatórios, funis, clientes, produtos, integrações e dados de atendimento via WhatsApp.",
  },
  {
    title: "3. Contas e responsabilidades",
    body: "Cada cliente é responsável por manter suas credenciais seguras, controlar usuários autorizados, garantir que possui permissão para integrar contas, APIs e ativos de terceiros, e utilizar a plataforma de forma lícita.",
  },
  {
    title: "4. Uso de integrações da Meta e WhatsApp",
    body: "Ao conectar uma conta WhatsApp Business por Embedded Signup ou webhook, o cliente confirma que possui autorização para vincular a conta, receber mensagens, processar eventos e operar a integração em conformidade com as políticas da Meta, WhatsApp Business e leis aplicáveis.",
  },
  {
    title: "5. Uso permitido",
    body: "É proibido usar a plataforma para envio de spam, fraude, mensagens ilegais, coleta indevida de dados, violação de direitos de terceiros, engenharia reversa, tentativa de acesso não autorizado ou qualquer atividade que comprometa a segurança do serviço.",
  },
  {
    title: "6. Dados e conteúdo do cliente",
    body: "O cliente mantém seus direitos sobre dados e conteúdos inseridos ou integrados à plataforma. O UP Dash processa essas informações para prestar, proteger, suportar e melhorar o serviço contratado.",
  },
  {
    title: "7. Disponibilidade e alterações",
    body: "Buscamos manter o serviço disponível e seguro, mas podem ocorrer indisponibilidades, manutenções, mudanças de APIs de terceiros ou limitações técnicas. Funcionalidades podem ser ajustadas para melhorar desempenho, segurança ou conformidade.",
  },
  {
    title: "8. Limitação de responsabilidade",
    body: "O UP Dash não garante resultados comerciais, faturamento, vendas ou performance de campanhas. Métricas e relatórios dependem da qualidade, disponibilidade e autorização das fontes de dados conectadas.",
  },
  {
    title: "9. Contato",
    body: "Para dúvidas sobre estes termos, suporte ou solicitações relacionadas à conta, entre em contato pelo e-mail contato@grupoup.com.br.",
  },
];

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10 md:py-14">
        <Link href="/login" className="inline-flex items-center">
          <img src="/up-dash-logo.png" alt="UP Dash" className="h-9 w-auto" />
        </Link>

        <section className="mt-10 space-y-5">
          <p className="text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
            Termos de Serviço
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Termos de Serviço do UP Dash
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Última atualização: 25 de maio de 2026. Estes termos regulam o uso do UP Dash,
            incluindo dashboards, integrações, autenticação e recursos de WhatsApp Business.
          </p>
        </section>

        <div className="mt-10 space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-md border border-border bg-card p-5">
              <h2 className="text-base font-semibold">{section.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <Link href="/privacy-policy" className="text-primary hover:underline">
            Política de Privacidade
          </Link>
          <Link href="/login" className="text-muted-foreground hover:text-foreground">
            Voltar ao login
          </Link>
        </div>
      </div>
    </main>
  );
}

import { Link } from "wouter";

const sections = [
  {
    title: "1. Quem somos",
    body: "UP Dash é uma plataforma de inteligência de dados, atendimento e performance para marcas e operações digitais. A plataforma ajuda empresas a visualizar indicadores, atendimento via WhatsApp, campanhas, clientes, produtos e eventos operacionais em um painel autenticado.",
  },
  {
    title: "2. Dados que podemos coletar",
    body: "Podemos tratar dados cadastrais e operacionais como nome, e-mail, telefone, empresa, documentos comerciais, identificadores de clientes, mensagens de atendimento, status de conversas, eventos de funil, identificadores de WhatsApp Business, WABA ID, Phone Number ID, logs técnicos, IP, dispositivo, data e hora de acesso.",
  },
  {
    title: "3. Dados recebidos da Meta e WhatsApp",
    body: "Quando um cliente conecta sua conta pelo WhatsApp Embedded Signup ou pelo webhook oficial da Meta, podemos receber e armazenar dados necessários para operar a integração, incluindo identificadores da conta WhatsApp Business, número conectado, payloads de webhook, mensagens recebidas, status de entrega e eventos de conversa.",
  },
  {
    title: "4. Como usamos os dados",
    body: "Usamos os dados para autenticar usuários, exibir dashboards, processar atendimento, calcular métricas de produtividade, registrar eventos do funil comercial, manter segurança da plataforma, diagnosticar falhas, cumprir obrigações legais e melhorar a experiência do serviço.",
  },
  {
    title: "5. Compartilhamento",
    body: "Não vendemos dados pessoais. Dados podem ser compartilhados com provedores necessários para operação da plataforma, como hospedagem, banco de dados, ferramentas de autenticação, APIs oficiais integradas e serviços de mensageria, sempre de acordo com a finalidade do serviço contratado.",
  },
  {
    title: "6. Retenção e segurança",
    body: "Mantemos os dados pelo tempo necessário para prestação do serviço, auditoria, segurança e obrigações legais. Aplicamos controles de acesso, autenticação, segregação por cliente e boas práticas para reduzir riscos de acesso não autorizado.",
  },
  {
    title: "7. Direitos dos titulares",
    body: "Titulares podem solicitar confirmação de tratamento, acesso, correção, exclusão, portabilidade ou informações sobre compartilhamento, conforme aplicável pela LGPD e demais normas de proteção de dados.",
  },
  {
    title: "8. Contato",
    body: "Para solicitações sobre privacidade, proteção de dados ou remoção de informações, entre em contato pelo e-mail contato@grupoup.com.br.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10 md:py-14">
        <Link href="/login" className="inline-flex items-center">
          <img src="/up-dash-logo.png" alt="UP Dash" className="h-9 w-auto" />
        </Link>

        <section className="mt-10 space-y-5">
          <p className="text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
            Política de Privacidade
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Política de Privacidade do UP Dash
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Última atualização: 25 de maio de 2026. Esta política descreve como o UP Dash coleta,
            usa, armazena e protege dados tratados na plataforma, incluindo integrações com a
            WhatsApp Cloud API oficial da Meta.
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
          <Link href="/terms-of-service" className="text-primary hover:underline">
            Termos de Serviço
          </Link>
          <Link href="/login" className="text-muted-foreground hover:text-foreground">
            Voltar ao login
          </Link>
        </div>
      </div>
    </main>
  );
}

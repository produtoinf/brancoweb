# Branco → SaaS: diagnóstico (Etapa 1)

Data: 13/10/2026 · Nada foi alterado no código. Este documento é o resultado da auditoria pedida antes de qualquer implementação.

---

## 1. O que o Branco já tem (e será reaproveitado)

| Parte | Onde está | Tecnologia | Situação |
|---|---|---|---|
| Servidor (API) | `worker/src/index.js` (≈680 linhas) | Cloudflare Worker + banco D1 (SQLite) | Funciona. Um único arquivo, sem dependências externas. |
| Painel | `admin/painel.html` (116 KB) | HTML + JS puro + Chart.js | Funciona. 5 abas: Visão geral, Follow-up, Financeiro, Prospecção, Clientes. |
| Área do cliente | `worker/src/cliente.html` + `cliente/index.html` | HTML + JS | Funciona por link secreto (token). |
| Site público | `index.html` (1,7 MB), `style.css`, `theme.js`, `app.js` | GitHub Pages | Identidade visual pronta (cores, fontes Archivo/JetBrains Mono, tema claro/escuro). |
| Contador do site | `track.js` → rotas `/t`, `/lead`, `/c` | Worker | Mede visitas e formulários **do site da Branco**. |
| Build | `worker/build.mjs` | Node | Gera o `worker.js` único para colar na Cloudflare. |

### Banco de dados (11 tabelas, todas sem dono)

`eventos`, `contatos`, `modelos`, `vendas`, `clientes`, `links`, `visitas_cliente`, `sessoes`, `config`, `limites`, `extrato`.

O que cada bloco do SaaS vai usar:

- **Prospecção** → busca em TomTom / HERE / Google Places / Serper / OpenStreetMap; completa WhatsApp lendo o site da empresa; salva em `contatos` com `origem = 'prospeccao'`. Regra de repetição já existe: mesmo telefone **ou** mesmo nome + cidade = não salva de novo.
- **CRM e funil** → `contatos.venda`: novo → mensagem enviada → respondeu → proposta → fechou → perdido. Lembretes automáticos em 2, 7 e 15 dias. Modelos de mensagem em `modelos`.
- **Financeiro** → `vendas` + `extrato` (importação do Nubank em CSV/OFX com conciliação).
- **Clientes** → `clientes` + `links` + `visitas_cliente` (área do cliente).

### Segurança que já existe (boa base)

Cookie HttpOnly/Secure/SameSite, sessão de 30 dias, limite de tentativas de login, limite de buscas por IP (tabela `limites`), CSP no painel, checagem de Origin em POST, comparação de senha em tempo constante, migração automática de colunas sem apagar nada.

---

## 2. O que falta para virar SaaS

| Necessidade | Hoje | O que precisa |
|---|---|---|
| **Contas de usuário** | Uma única senha (`ADMIN_SENHA`). Não existe tabela de usuários. | Cadastro, senha com hash, login, recuperação, verificação de e-mail, perfil. |
| **Envio de e-mail** | Nenhum. | Um provedor (ver §5). Sem isso não há verificação nem recuperação de senha. |
| **Isolamento de dados** | Nenhuma tabela tem `conta_id`. As **20 consultas** ao banco são globais. | Coluna `conta_id` em tudo + filtro obrigatório em cada consulta. É o ponto mais crítico. |
| **Planos e assinatura** | Não existe. | Tabelas de planos (configuráveis), assinaturas, cobranças, teste grátis. |
| **Pagamento** | Não existe. | Gateway recorrente + webhooks assinados e idempotentes. |
| **Controle de consumo** | Só limite por IP (anti-abuso). | Contador de empresas encontradas por conta e por ciclo, com dedupe. |
| **Equipes (plano Agency)** | Não existe. | Membros, papéis, convite, CRM compartilhado, indicadores por usuário. |
| **Painel do dono do SaaS** | Não existe. | Área separada, só para você: assinantes, faturamento, consumo, erros. |
| **Landing page de vendas** | O site atual vende a agência, não o software. | Página nova com planos, demo, FAQ, cadastro e checkout. |
| **Testes automatizados** | Nenhum (nem `package.json`). | Mínimo: teste de isolamento com 2 contas em cada rota. |

### Funcionalidades prometidas nos planos que ainda NÃO existem

- **Filtros avançados** → hoje só há nicho, cidade/UF, fonte, "só com WhatsApp", "só sem site". Não existe separação básico/avançado. Sugestão: avançado = avaliação do Google, tem/não tem Instagram, raio, "ainda não contatado".
- **Relatórios de desempenho** → não existem para o assinante. O que existe é a Visão geral do **site da Branco**. Precisa ser criado: mensagens enviadas, taxa de resposta, fechamentos por período, por nicho.
- **Histórico de negociações** → só há anotações livres e um contador. Precisa de um log de mudanças de etapa com data.
- **Indicadores por usuário** → impossível hoje (não há usuários).
- **Gestão de oportunidades da agência** → precisa ser definido o que significa; sugestão: dono da conta vê o funil de todos, cada membro vê o seu.

---

## 3. Mudanças no banco de dados

### Tabelas novas

| Tabela | Para quê |
|---|---|
| `contas` | A "empresa" do assinante (workspace). Plano, status, ciclo de cobrança. |
| `usuarios` | E-mail, hash da senha, nome, verificado, é_admin_saas. |
| `membros` | Quem pertence a qual conta e com que papel (dono / membro). |
| `planos` | Nome, preço, limites e permissões em JSON — **editável no painel admin**, sem mexer em código. |
| `assinaturas` | Conta ↔ plano, status (teste / ativa / atrasada / cancelada), início/fim do ciclo, id no gateway. |
| `cobrancas` | Histórico de cada cobrança vinda do gateway. |
| `uso` | Empresas encontradas por conta e por ciclo. |
| `empresas_vistas` | Chave única por conta (telefone normalizado **ou** nome+cidade **ou** id da fonte) → **não cobra crédito duas vezes pela mesma empresa**. |
| `tokens_email` | Códigos de verificação e de recuperação de senha, com validade. |
| `webhooks` | Id de cada evento recebido do gateway → idempotência (mesmo evento 2x não faz nada 2x). |
| `log` | Erros e eventos importantes para o painel admin. |

### Colunas novas nas tabelas atuais

`conta_id` em `contatos`, `modelos`, `vendas`, `clientes`, `links`, `extrato`, `config`, `visitas_cliente`, `eventos`. `usuario_id` em `sessoes`. `usuario_id` (quem mexeu) em `contatos` e `vendas`, para os indicadores por usuário.

### Migração dos seus dados (sem perder nada)

1. Backup: `wrangler d1 export branco --output backup.sql` (ou pelo painel da Cloudflare).
2. Criar a conta nº 1 "Branco" com você como dono, plano Agency, sem cobrança.
3. `UPDATE ... SET conta_id = 1` em todas as tabelas existentes. Só adiciona coluna e preenche; nada é apagado.
4. Sua senha atual (`ADMIN_SENHA`) continua valendo para você até criar seu usuário com e-mail; depois ela sai.
5. Reversão: o `worker.js` anterior fica guardado; colar de volta restaura, e as colunas extras não atrapalham a versão antiga.

---

## 4. Riscos técnicos a resolver

| Risco | Gravidade | Como tratar |
|---|---|---|
| **Vazamento entre contas**: uma consulta sem `WHERE conta_id` mostra dados de outro assinante. | Alta | Todas as consultas passam por uma função que exige a conta. Teste automático: cria 2 contas, chama cada rota, confere que uma não vê a outra. |
| **Termos das fontes de dados**: TomTom proíbe armazenar os resultados; o CRM salva nome/telefone. Google Places também restringe guardar dados (exceto o id do lugar). Para uso comercial isso é risco jurídico. | Alta | Decisão de negócio (ver §7). OpenStreetMap permite armazenar (licença ODbL, com atribuição). Ler os termos ou pedir confirmação por escrito antes de vender. |
| **Chave de API única**: hoje uma chave TomTom (2.500/dia) serve tudo. Com 30 assinantes acaba em horas. | Alta | Teto por conta (os limites dos planos), cache de buscas repetidas (mesmo nicho+cidade em 24 h é servido do cache, sem gastar), monitoramento no painel admin, chaves pagas quando crescer. |
| **Senha única sem usuários** | Alta | Hash PBKDF2 (o Worker já tem `crypto.subtle`), bloqueio por tentativas, verificação de e-mail. |
| **Sem testes** | Média | Criar os testes de isolamento e de limites **antes** de abrir cadastro. |
| **Painel e Worker em arquivo único** (116 KB / 200 KB) | Baixa | Ainda é administrável. Separar em módulos só se crescer muito; o build já existe. |
| **LGPD**: dados de empresas (terceiros) e dos assinantes. | Média | Política de privacidade, botão "excluir minha conta", registrar consentimento, não guardar cartão (o gateway guarda). |
| **Contador do site (`/t`)** é da Branco, não dos assinantes. | Baixa | Fica como recurso da conta nº 1. Pode virar feature depois ("contador do seu site"). |
| **Webhooks de pagamento** | Média | Verificar assinatura HMAC, guardar o id do evento, responder 200 só depois de gravar. |

---

## 5. Arquitetura proposta (simples, segura, na mesma base)

Mantém **1 Worker + 1 banco D1** (o que já existe e custa quase zero). Não troca de linguagem nem de hospedagem.

```
GitHub Pages (grátis)                     Cloudflare Worker (já existe)
├─ branco.site (site da agência, igual)   ├─ /app            → painel do assinante (o painel.html de hoje)
├─ /saas (landing page de vendas) ───────►├─ /api/...        → tudo filtrado por conta_id
└─ /cliente (área do cliente, igual)      ├─ /api/conta/...  → cadastro, login, e-mail, perfil, equipe
                                          ├─ /api/assinatura → checkout, upgrade, cancelar
                                          ├─ /api/webhook/<gateway> → assinado + idempotente
                                          └─ /saas-admin     → só para is_admin_saas (você)
                                                 │
                                           D1 (SQLite) ── 1 banco, tudo com conta_id
```

Regras fixas:

- **Autenticação**: sessão em cookie (como hoje) ligada a `usuario_id`; cada pedido resolve usuário → conta → papel → plano **uma vez** e passa adiante.
- **Autorização**: a tabela `planos` diz o que cada plano pode (`{"usuarios":3,"empresas_mes":4000,"financeiro":true,...}`). O servidor confere; o painel só esconde botões.
- **Consumo**: `uso` soma por ciclo; `empresas_vistas` evita cobrar duas vezes; o limite é conferido **antes** de chamar a API externa.
- **Teste grátis**: conta criada com e-mail verificado → assinatura `teste`, 7 dias, 30 empresas. No fim: dados ficam, buscar/enviar bloqueia, aparece convite para assinar.
- **Pagamento**: nunca passa pelo Branco. Checkout do gateway → webhook atualiza `assinaturas`.
- **Chaves secretas**: só nos secrets do Worker (como hoje: TOMTOM_KEY, SERPER_KEY...). Nada no HTML.

### Gateway de pagamento (opções para o Brasil)

| Opção | Pontos fortes | Pontos fracos | Taxa aproximada* |
|---|---|---|---|
| **Stripe Billing** | Melhor para assinatura: checkout pronto, portal do cliente (trocar cartão, upgrade/downgrade com rateio, cancelar), retentativa automática, webhooks excelentes, sandbox fácil. | Pix só em cobrança avulsa (não recorrente); boleto não recorrente. | ≈ 3,99% + R$ 0,39 no cartão |
| **Asaas** | Feito para o Brasil: cartão, **Pix e boleto recorrentes**, nota fiscal, API simples, webhooks. Muito usado por SaaS brasileiros. | Upgrade/downgrade com rateio é manual; painel do cliente menos pronto. | ≈ R$ 1 a 2 fixo + % no cartão |
| **Mercado Pago** | Marca conhecida, assinaturas com cartão. | API de assinaturas mais limitada, suporte fraco, Pix recorrente limitado. | ≈ 4,98% |
| **Pagar.me / Efí** | Completos, boleto/Pix. | Mais burocracia para começar; APIs mais pesadas. | varia |

\* Taxas de memória: **confirme no site de cada um**, mudam com frequência.

**Recomendação**: **Stripe Billing** para começar. Ele já resolve upgrade, downgrade, cancelamento, cartão recusado, retentativa e histórico — isso é 70% do código de cobrança que não precisaremos escrever. Se Pix recorrente for indispensável para o seu público, a segunda opção é **Asaas**. A integração será feita atrás de uma camada única, para poder trocar de gateway depois sem refazer o resto.

### E-mail transacional

**Resend** (plano grátis de 3.000 e-mails/mês, API simples, funciona em Worker) ou **Brevo**. Precisa de um domínio próprio verificado (ex.: `app.brancowebs.com.br`). Cloudflare não envia e-mail sozinho.

### Fontes de dados para a prospecção (custo e licença)

| Fonte | Grátis | Guardar os dados? | Observação |
|---|---|---|---|
| TomTom | 2.500/dia | **Não permite** (termos, seção 12) | Boa cobertura. Para SaaS precisa de contrato ou não salvar. |
| HERE | 1.000/dia (pede cartão) | Restrito | Semelhante ao TomTom. |
| Google Places | cota mensal (pede cartão) | Só o `place_id`; demais por até 30 dias | Melhor telefone. Caro em volume. |
| Serper (pesquisa Google) | créditos iniciais | Zona cinzenta | Usado só para completar telefone. |
| OpenStreetMap | ilimitado (uso justo) | **Sim** (ODbL, com atribuição) | Cobertura fraca no Brasil. |
| Site da própria empresa | — | Sim (dado público) | Já usamos para pegar o WhatsApp. |

Isto é decisão de negócio (§7): o produto vende exatamente "guardar as empresas encontradas no CRM".

---

## 6. Roteiro de implementação

Cada etapa vira um PR separado, com o Worker anterior guardado para reverter.

| Etapa | O que entrega | Risco | Estimativa |
|---|---|---|---|
| **1 · Auditoria** | Este documento. | — | feito |
| **2 · Base multi-conta** | Tabelas `contas/usuarios/membros`, `conta_id` em tudo, migração dos seus dados para a conta 1, cadastro/login/e-mail/recuperação, **teste automático de isolamento**. Você continua usando o painel normalmente. | Alto (mexe em tudo) | 3 PRs |
| **3 · Planos, limites e teste grátis** | Tabela `planos` configurável, `uso` + `empresas_vistas`, bloqueios por plano no servidor, trial de 7 dias, avisos no painel, cache de buscas. | Médio | 2 PRs |
| **4 · Cobrança** | Stripe (ou Asaas): checkout, webhooks, upgrade/downgrade, cancelar, histórico, cartão recusado. Modo sandbox primeiro. | Médio | 2 PRs |
| **5 · Equipes (Agency)** | Convite por e-mail, papéis, CRM compartilhado, indicadores por usuário, log de negociações. | Médio | 2 PRs |
| **6 · Painel admin do SaaS** | Assinantes, MRR, cancelamentos, consumo de buscas e das APIs, trials, erros, editar planos. | Baixo | 1–2 PRs |
| **7 · Comercialização** | Landing page (mesma identidade), fluxo cadastro → trial → assinar, FAQ, demo. | Baixo | 2 PRs |
| **8 · Testes finais** | Isolamento, limites, pagamentos em sandbox, regressão de tudo que já existe, revisão de segurança. | — | 1 PR |

Ordem importa: **2 antes de tudo** (sem isolamento não dá para abrir cadastro), e nenhum cadastro público antes da etapa 8.

---

## 7. Decisões que preciso de você antes de começar

1. **Fontes de dados**: aceitar o risco dos termos (TomTom/Google) por enquanto, ou já buscar uma fonte com licença de armazenamento? Minha sugestão: começar com o que há, deixar claro no termo de uso, e orçar uma fonte licenciada quando houver assinantes pagando.
2. **Gateway**: Stripe (recomendado) ou Asaas (se Pix recorrente for essencial)?
3. **E-mail**: Resend com um domínio seu. Qual domínio? (ex.: `app.brancowebs.com.br`)
4. **Endereço do app**: continuar em `branco-admin.brancowebs.workers.dev` ou usar domínio próprio? (Domínio próprio é necessário para e-mail e passa mais confiança.)
5. **Área do cliente e contador do site**: ficam só para a sua conta, ou viram funcionalidade dos planos (ex.: Pro/Agency)?
6. **Funcionalidades ainda inexistentes** (§2): confirmar a definição de "filtros avançados", "relatórios" e "oportunidades da agência" como propus, ou ajustar.

Com essas respostas eu começo a **Etapa 2** num PR separado, sem tocar no que já funciona.

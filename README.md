# Avaliação de Desempenho UNISO — base técnica v1

Primeira versão para apresentação e validação com RH, Marketing e Diretoria. O formulário aplica **10 critérios inteiros de 0 a 10**, total de 100 pontos, resultado imediato, alerta individual, plano de ação e PDF automático com campos de assinatura. O gestor e o RH consultam os PDFs mediante login. **Não há regra de pagamento de bônus nesta versão.**

## Antes da publicação

1. Solicite à equipe da UNISO a planilha original de avaliação e a política do bônus. Compare perguntas, pesos, períodos, tratamento de afastamentos e faixas com esta proposta. RH e Diretoria devem aprovar a versão final antes do uso com colaboradores.
2. Crie **um projeto Firebase separado, pertencente à conta da UNISO, para avaliações de RH**. O inventário e os outros painéis podem ter regras de leitura pública; implantar este `firestore.rules` no banco compartilhado sobrescreveria essas regras e poderia interromper os sistemas existentes. Não faça isso.
3. Confirme disponibilidade e autorização para o plano **Blaze** da UNISO: o uso das Cloud Functions para PDF e do Cloud Storage exige conta de faturamento. Configure orçamento e alertas no projeto.
4. No novo projeto, ative Authentication > método E-mail/senha; crie Firestore, Storage e adicione um aplicativo Web. Coloque o objeto de configuração do Web app em `public/config.js` (sem senha). A configuração Web é identificadora pública; o bloqueio real é feito pelas regras e funções no servidor.
5. Cadastre os usuários autorizados em Authentication. Para cada UID criado, adicione manualmente no Firestore um documento `users/{UID}` com `name` (texto), `role` (`admin`, `gestor`, `rh` ou `diretoria`) e `active` (booleano `true`). **Seu usuário pode ter `role: admin`; seu acesso à conta Firebase/GitHub da UNISO continua separado desse perfil.** Desativação: altere `active` para `false` e desabilite o usuário no Authentication.

## Publicação em projeto Firebase exclusivo de RH

É preciso Node.js, Firebase CLI e permissão administrativa no projeto da UNISO.

```bash
cd avaliacao-uniso
npm install --prefix functions
firebase login
firebase use --add
firebase deploy --only firestore:rules,storage,functions,hosting
```

O projeto pode ser versionado no **GitHub da UNISO**. Se desejar usar GitHub Pages para a interface, publique somente `public/`, acrescente o domínio da página à lista de domínios autorizados em Authentication e implante Firestore Rules, Storage Rules e Functions pelo Firebase CLI. GitHub Pages não protege os dados: a segurança depende do Firebase Authentication, das regras e das funções.

> **Atenção:** não execute o comando de deploy acima apontando para o projeto Firebase já usado pelo painel público de estoque. O comando substitui o conjunto de regras padrão do Firestore.

## Fluxo disponível

1. Gestor autorizado entra com e-mail e senha. RH e Diretoria acessam apenas o histórico; administrador pode registrar e consultar todas as avaliações.
2. Gestor preenche dados, dez notas e evidências. O painel apresenta total, média, aproveitamento, classificação e alertas.
3. Abaixo de 70 pontos ou com algum critério até 5, o plano de ação passa a ser obrigatório. Alerta crítico é registrado para nota até 4.
4. Ao confirmar, uma Cloud Function valida novamente as notas, a permissão e o plano; gera um PDF com logo e assinaturas; salva o documento em Storage privado e o registro no Firestore. A versão da política e o UID do avaliador ficam registrados. O PDF é baixado para o gestor.
5. RH, Diretoria e administrador acessam os documentos pelo histórico, com controle de perfil no servidor. O gestor vê somente os registros que criou.

## Regra de pontuação proposta

| Pontos | Classificação |
|---:|---|
| 90–100 | Excelente desempenho |
| 80–89 | Muito bom desempenho |
| 70–79 | Bom desempenho / dentro do esperado |
| 60–69 | Em desenvolvimento |
| 0–59 | Pontuação mínima não atingida — Acompanhar o colaborador |

Média = pontos/10. Aproveitamento = pontos em %. Alerta crítico = algum critério de 0 a 4. Plano obrigatório = pontos inferiores a 70 ou critério de 0 a 5. O valor/percentual do bônus e possíveis travas dependem de aprovação interna. Ausência justificada e afastamentos devem ser tratados na política antes de atribuir nota a assiduidade.

## Integrações pendentes

- **Envio automático por e-mail ao RH e cópia no Google Drive/Sheets:** o PDF já é gerado, guardado e disponível no histórico; o envio e as cópias precisam das contas/destinos corporativos, permissões e política de retenção da UNISO. Não configure um endpoint público do Apps Script nem publique PDFs no GitHub.
- **Revisão, contestação e assinatura digital:** a versão atual é um registro imutável, pronto para impressão e assinatura física. Caso o RH peça revisão, deve-se implementar uma nova versão ou ciclo de aprovação em vez de editar notas silenciosamente.
- **Identificador do colaborador:** hoje utiliza nome e setor. Após receber a planilha/base RH, considere matrícula funcional para evitar homônimos.

## Arquivos

`public/` interface; `functions/` validação e PDFs; `firestore.rules` controle de leitura; `storage.rules` bloqueia acesso direto aos PDFs; `shared/scoring.js` regra de pontuação, copiada para `public/scoring.js` e `functions/scoring.js`; `tests/` testes das faixas e alertas.

Teste local da regra: `npm test`. Faça um piloto com colaboradores fictícios no projeto de RH antes de usar dados reais. Quando a política mudar, altere o cálculo nas três cópias e incremente `POLICY_VERSION`.

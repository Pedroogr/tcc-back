# Documentação para continuidade

Esta pasta reúne o contexto necessário para outro agente retomar o backend do
TCC sem reconstruir a história pela leitura do código inteiro.

## Arquivos

- [`agent-handoff.md`](agent-handoff.md): ordem de leitura, estado da sessão,
  setup e cuidados para alterar o backend;
- [`current-state.md`](current-state.md): snapshot curto do que já existe e do
  que verificar a seguir;
- [`monografia/notas-de-processo-e-decisoes-do-tcc.md`](monografia/notas-de-processo-e-decisoes-do-tcc.md):
  diário retrospectivo de engenharia de todo o TCC;
- [`superpowers/specs/2026-10-20-servidor-inferencia-gpu-remoto-design.md`](superpowers/specs/2026-10-20-servidor-inferencia-gpu-remoto-design.md):
  arquitetura aprovada do servidor privado de inferência;
- [`superpowers/plans/2026-10-20-servidor-inferencia-gpu-remoto.md`](superpowers/plans/2026-10-20-servidor-inferencia-gpu-remoto.md):
  plano test-first de implementação e validação.

As regras permanentes continuam no código, no schema Prisma e nos testes. A
documentação não substitui a validação desses arquivos.

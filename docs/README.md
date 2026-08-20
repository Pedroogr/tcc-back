# Documentação para continuidade

Esta pasta reúne o contexto necessário para outro agente retomar o backend do
TCC sem reconstruir a história pela leitura do código inteiro.

## Arquivos

- [`agent-handoff.md`](agent-handoff.md): ordem de leitura, estado da sessão,
  setup e cuidados para alterar o backend;
- [`current-state.md`](current-state.md): snapshot curto do que já existe e do
  que verificar a seguir.

As regras permanentes continuam no código, no schema Prisma e nos testes. A
documentação não substitui a validação desses arquivos.

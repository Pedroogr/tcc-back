# Domain Docs

Como as skills de engenharia devem consumir a documentação de domínio.

## Antes de explorar

- Ler `CONTEXT.md` na raiz, quando existir.
- Se existir `CONTEXT-MAP.md`, ler os contextos relevantes indicados nele.
- Ler em `docs/adr/` as ADRs relacionadas à área que será alterada.
- Se esses arquivos não existirem, prosseguir silenciosamente.

A skill `domain-modeling` cria essa documentação quando termos ou decisões de domínio forem efetivamente definidos.

## Estrutura

Este repositório usa o layout single-context:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Vocabulário

Ao nomear conceitos de domínio em issues, propostas, hipóteses ou testes, usar os termos definidos em `CONTEXT.md`. Evitar sinônimos que o glossário tenha rejeitado.

Se um conceito necessário não estiver documentado, verificar se o termo está sendo inventado ou registrar a lacuna para `domain-modeling`.

## Conflitos com ADRs

Se uma proposta contradisser uma ADR existente, apontar explicitamente o conflito em vez de substituir a decisão silenciosamente.

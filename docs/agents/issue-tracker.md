# Issue tracker: Local Markdown

Issues e especificações deste repositório são arquivos Markdown em `.scratch/`.

## Convenções

- Uma funcionalidade por diretório: `.scratch/<feature-slug>/`
- A especificação fica em `.scratch/<feature-slug>/spec.md`
- Cada ticket de implementação possui seu próprio arquivo em `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- A numeração começa em `01`
- O estado de triagem é registrado em uma linha `Status:` próxima ao início do arquivo
- Comentários e histórico são acrescentados ao final, sob `## Comments`

## Publicar no issue tracker

Quando uma skill solicitar a publicação de uma issue, criar um arquivo em `.scratch/<feature-slug>/`, criando o diretório quando necessário.

## Buscar um ticket

Ler o arquivo indicado pelo caminho ou número fornecido pelo usuário.

## Operações do wayfinder

- Mapa: `.scratch/<effort>/map.md`
- Ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- `Type:` registra `research`, `prototype`, `grilling` ou `task`
- `Status:` registra `claimed` ou `resolved`
- `Blocked by: NN, NN` registra dependências
- Para assumir um ticket, definir `Status: claimed` antes de trabalhar
- Para concluir, acrescentar a resposta sob `## Answer`, definir `Status: resolved` e registrar a decisão no mapa

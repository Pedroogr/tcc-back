# Demonstração completa em uma VM com GPU no Google Cloud

Este runbook coloca frontend, API, PostgreSQL, worker de gestos, gateway e
Cloudflare Quick Tunnel na mesma VM. O desktop não participa da execução.

## 1. Antes de criar a VM

No Console do Google Cloud, confirme o projeto correto e siga para **IAM e
administrador > Cotas e limites do sistema**. Filtre por **NVIDIA T4 GPUs** e
confirme cota regional de pelo menos `1` em `southamerica-east1`.

Cota não é capacidade. A cota autoriza a conta a pedir uma T4; ela não garante
que exista uma T4 livre naquele momento. Se a criação falhar por falta de
recurso, tente, nesta ordem, `southamerica-east1-a`,
`southamerica-east1-b` e `southamerica-east1-c`. Não peça nova cota por uma
falha de capacidade da zona.

Em **VPC network > Firewall**, crie ou confira uma regra de entrada com:

- origem `35.235.240.0/20`;
- protocolo e porta somente `tcp:22`;
- destino limitado à VM por tag de rede ou conta de serviço, se possível.

Essa é a faixa oficial do IAP para encaminhamento TCP. Desative uma regra SSH
aberta para `0.0.0.0/0` se ela alcançar a VM.

## 2. Criar a VM

Abra **Compute Engine > Instâncias de VM > Criar instância** e use:

| Campo | Valor |
|---|---|
| Região | `southamerica-east1` (São Paulo) |
| Zona | uma entre `-a`, `-b` ou `-c` com capacidade |
| Série/tipo | N1 / `n1-standard-4` |
| GPU | 1 × NVIDIA T4 |
| Imagem | Ubuntu 22.04 LTS x86-64 |
| Disco de inicialização | ao menos 50 GB |
| IPv4 externo | efêmero |
| Manutenção | encerrar a VM, exigido por GPU |

Em **Firewall**, não marque “Permitir tráfego HTTP” nem “Permitir tráfego
HTTPS”. A aplicação não publica portas na VM; o Quick Tunnel cria uma conexão
de saída.

Em **Segurança**, deixe **Secure Boot desativado**. Isso simplifica a instalação
do módulo do driver para esta VM descartável de demonstração. Mantenha vTPM e
monitoramento de integridade se estiverem habilitados. Habilite **OS Login** nos
metadados do projeto ou da instância e acesse a VM somente pelo botão
**SSH > Abrir na janela do navegador usando IAP**.

## 3. Clonar os dois repositórios

Pelo SSH/IAP, clone os repositórios como diretórios irmãos:

```bash
mkdir -p "$HOME/tcc"
cd "$HOME/tcc"
git clone https://github.com/Pedroogr/tcc-back.git
git clone https://github.com/Pedroogr/tcc-front.git
cd tcc-back
```

Para testar uma branch ainda não integrada, faça checkout da mesma branch nos
dois repositórios antes de continuar.

## 4. Preparar o host

O wizard detecta o que já foi feito. Ele confirma cada alteração privilegiada,
portanto pode ser interrompido e executado novamente:

```bash
cd "$HOME/tcc/tcc-back"
./scripts/gcp-demo/prepare-host.sh
```

O instalador do driver pode reiniciar a VM. Se isso ocorrer, reconecte pelo IAP,
volte ao repositório e execute o mesmo comando. O wizard também pode encerrar
depois de adicionar seu usuário ao grupo `docker`; reconecte para que a nova
sessão receba o grupo e execute-o novamente.

Ao final, ele valida:

- `nvidia-smi` no host;
- `nvidia-smi` dentro de um contêiner CUDA;
- Docker Engine e Compose v2;
- os repositórios irmãos;
- a resolução completa de `docker compose config`.

## 5. Iniciar e conferir

Execute a inicialização em um terminal que não esteja sendo compartilhado. As
credenciais e o token da rodada aparecem uma única vez depois que todos os
smokes automáticos passam:

```bash
./scripts/gcp-demo/start.sh
./scripts/gcp-demo/status.sh
```

O primeiro início baixa e constrói imagens grandes de CUDA/PyTorch e pode levar
vários minutos. Não interrompa enquanto houver atividade de download ou build.
O resultado esperado do segundo comando é `status=ready` acompanhado da URL
HTTPS `trycloudflare.com` da rodada.

Não copie credenciais para o Git, para URLs ou para capturas de tela. A URL do
Quick Tunnel não é autenticação; use as contas e a senha exibidas pelo launcher.

## 6. Checklist manual da jornada

O launcher só declara infraestrutura pronta. Em outro computador e,
preferencialmente, na rede que será usada na defesa, confira manualmente:

- abrir a URL HTTPS e fazer login com a leiloeira de demonstração;
- permitir acesso à câmera no navegador;
- abrir a tela de gestos e confirmar que a pose é reconhecida;
- confirmar que a interface recebe atualizações Socket.IO sem reconexões
  contínuas;
- entrar também como comprador e concluir um evento comercial de demonstração
  sem usar dados reais;
- aquecer o fluxo por 30 segundos e então medir durante dois minutos, anotando
  FPS efetivo, RTT, latência p50/p95, tempo de inferência e descarte de frames;
- comparar o resultado com os 6 FPS observados no servidor residencial.

Não grave frames, poses ou imagens da câmera durante a medição. Uma sinalização
Socket.IO saudável não garante mídia WebRTC: redes restritivas ainda podem
bloquear a conexão peer-to-peer quando não existe servidor TURN.

Para diagnóstico na VM:

```bash
./scripts/gcp-demo/status.sh
docker compose --project-name tcc-gpu-demo \
  --env-file .runtime/persistent.env \
  --env-file .runtime/run.env \
  -f deploy/gcp/compose.yaml ps
nvidia-smi
```

Os arquivos em `.runtime/` contêm segredos. Não mostre seu conteúdo nem os
adicione ao Git.

## 7. Encerrar a rodada e a cobrança principal

Primeiro invalide a URL pública e pare os contêineres, preservando banco e
uploads:

```bash
./scripts/gcp-demo/stop.sh
```

**Esse comando não para a cobrança da VM nem da GPU.** Depois dele, vá a
**Compute Engine > Instâncias de VM**, selecione a instância e clique em
**Parar**. CPU e GPU deixam de ser cobradas quando a VM termina de parar, mas o
disco persistente continua gerando um custo pequeno. Como o IPv4 é efêmero, ele
pode mudar na próxima inicialização sem afetar o Quick Tunnel.

Para apagar deliberadamente os dados da demonstração antes de parar a VM:

```bash
./scripts/gcp-demo/reset-data.sh --confirm DELETE-DEMO-DATA
```

Esse reset remove apenas os volumes e o estado pertencentes ao projeto Compose
da demonstração; ele não é necessário entre reinicializações normais.

## Referências oficiais

- [Drivers NVIDIA no Compute Engine](https://cloud.google.com/compute/docs/gpus/install-drivers-gpu)
- [Docker Engine no Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [GPU no Docker Compose](https://docs.docker.com/compose/how-tos/gpu-support/)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
- [IAP para encaminhamento TCP](https://cloud.google.com/iap/docs/using-tcp-forwarding)

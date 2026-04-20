# Recuperação de Log por Similaridade

Este repositório contém uma configuração de exemplo para executar um frontend (aplicação Vite/React) junto com o Traefik como proxy reverso via Docker Compose. O objetivo deste README é fornecer os pré-requisitos, instruções para iniciar o ambiente em desenvolvimento e dicas de solução de problemas.

## Pré-requisitos

- Docker (versão recente) instalado e em execução
- Docker Compose (v2 ou compatível) disponível como `docker compose` ou `docker-compose`
- Node.js (recomendado >= 16) e npm (somente se for necessário rodar o frontend localmente sem Docker)
- Acesso ao terminal (Linux/macOS/Windows WSL)

> Observação: Este projeto contém um `docker-compose.yml` e um `traefik.yml` na raiz do workspace. Ajuste as rotas e certificados no `traefik.yml` conforme seu ambiente (ex.: redirecionamento HTTP/HTTPS, entradas de hosts, certificados ACME).

## Estrutura do projeto (resumida)

- `docker-compose.yml` - define serviços Docker (provavelmente traefik e o serviço web)
- `traefik.yml` - configuração do Traefik
- `Dockerfile` - instruções de build do container (se aplicável)
- `teste/` - código do frontend (Vite + React)
	- `package.json` - dependências e scripts
	- `vite.config.js`, `src/` - código fonte do frontend

## Como iniciar (via Docker Compose)

1. Abra um terminal na raiz do projeto (`/home/luizg/traefik-setup`).
2. (Opcional) Ajuste `traefik.yml` e `docker-compose.yml` conforme suas necessidades (ports, redes, volumes, domínio).
3. Inicie os serviços:

```bash
# usando o Docker Compose v2 (recomendado)
docker compose up -d --build

# ou, se você tiver o docker-compose clássico
docker-compose up -d --build
```

4. Verifique os logs e o status dos containers:

```bash
docker compose ps
docker compose logs -f
```

5. Acesse a aplicação no host/porta configurada (ex.: http://localhost) ou via domínio configurado no Traefik.

## Como rodar apenas o frontend localmente (sem Docker)

Se quiser desenvolver apenas o frontend localmente:

1. Entre na pasta do frontend:

```bash
cd teste
```

2. Instale dependências e rode em modo de desenvolvimento:

```bash
npm install
npm run dev
```

3. O Vite normalmente expõe a aplicação em `http://localhost:5173` (confirme o endereço no terminal).

Se estiver usando o frontend localmente e o Traefik em Docker, ajuste as URLs de API e CORS conforme necessário.

## Scripts úteis (prováveis) em `teste/package.json`

- `npm run dev` - inicia o servidor de desenvolvimento Vite
- `npm run build` - cria o build de produção em `dist/`
- `npm run preview` - pré-visualiza o build de produção localmente

Confirme os scripts exatos abrindo `teste/package.json`.

## Dicas de troubleshooting

- Se o Traefik não encaminhar para o serviço, verifique os labels no `docker-compose.yml` do serviço web e as entradas em `traefik.yml`.
- Verifique se as portas usadas não estão em conflito com outros serviços.
- Se o container não sobe, veja os logs com `docker compose logs <service>`.
- Se o frontend não atualiza mudanças durante desenvolvimento, confirme que está rodando `npm run dev` dentro da pasta `teste`.

## Segurança e produção

- Nunca exponha portas administrativas do Traefik sem autenticação.
- Configure certificados TLS (Let's Encrypt via ACME ou certificados próprios) no `traefik.yml`.
- Para produção, use volumes para persistir certificados e dados necessários.

## Próximos passos sugeridos

- Adicionar documentação de como configurar domínios e certificados no Traefik.
- Incluir exemplos de `docker-compose.override.yml` para desenvolvimento.
- Escrever instruções de deploy contínuo (CI/CD).

---


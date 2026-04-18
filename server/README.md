Para rodar:

```
# Subir o elastic search em http://localhost:9200
docker compose up -d

# Criar um .venv para executar a aplicação
python3 -m venv .venv
source .venv/bin/activate

# Instalar as dependencias necessárias
pip install -r requirements.txt

# Rodar a aplicação em http://localhost:5000
flask --app flaskr run --debug
```

Para fazer upload de documento, use o curl

```
curl -X POST http://localhost:5000/logs/upload -F "file=@<localização do arquivo>"
```

Para fazer pesquisa, use o curl
```
curl -X GET "http://localhost:5000/logs/search?q=<query>"
```
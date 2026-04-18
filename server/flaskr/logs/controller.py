from flask import jsonify, request
from .services import LogService

log_service = LogService()

def upload_logs_controller():
    if 'file' not in request.files:
        return jsonify({"error": "Não há nenhum arquivo enviado"}), 400
    
    file = request.files['file']
    
    try:
        total = log_service.process_bulk_upload(file)
        return jsonify({"status": "success", "processados": total}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
    
def search_logs_controller():
    # Pega o parâmetro 'q' da URL: /search?q=erro+conexao
    query = request.args.get('q', '')
    if not query:
        return jsonify({"error": "Parâmetro 'q' é obrigatório"}), 400
    
    try:
        results = log_service.search_logs(query)
        # Formatamos para retornar ID, Score (BM25) e o Conteúdo
        output = [
            {
                "id": hit["_id"],
                "score": hit["_score"], 
                "log": hit["_source"]["log"]
            } for hit in results
        ]
        return jsonify(output), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
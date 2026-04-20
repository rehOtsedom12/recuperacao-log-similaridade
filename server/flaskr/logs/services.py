from elasticsearch import Elasticsearch, helpers

class LogService:
    def __init__(self):
        self.es = Elasticsearch("http://localhost:9200")
        self.index = "logs_bm25"
        
    def process_bulk_upload(self, file_stream):
        def generate_actions():
            for line in file_stream:
                decoded_line = line.decode('utf-8').strip()
                if decoded_line:
                    yield {
                        "_index": self.index,
                        "_source": {
                            "log": decoded_line
                        }
                    }
                    
        success, _ = helpers.bulk(self.es, generate_actions())
        return success
    
    def search_logs(self, query_text):
        """
        Realiza a busca BM25. 
        O Elasticsearch calcula o score automaticamente usando 'match'.
        """
        query = {
            "query": {
                "match": {
                    "log": {
                        "query": query_text,
                        "fuzziness": "AUTO" # Tolera pequenos erros de digitação
                    }
                }
            }
        }
        res = self.es.search(index=self.index, body=query)
        return res['hits']['hits']
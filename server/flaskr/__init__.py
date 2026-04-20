from flask import Flask

def create_app(test_config=None):
    app = Flask(__name__)
    
    from .logs import bp
    app.register_blueprint(bp, url_prefix='/logs')
    
    print(app.url_map)
    
    return app
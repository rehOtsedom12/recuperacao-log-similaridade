from . import bp
from .controller import upload_logs_controller, search_logs_controller

@bp.route('/upload', methods=['POST'])
def upload_logs():
    return upload_logs_controller()

@bp.route('/search', methods=['GET'])
def search_logs():
    return search_logs_controller()
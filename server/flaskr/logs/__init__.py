from flask import Blueprint

bp = Blueprint('logs', __name__)

from . import routes
"""
Internal endpoints blueprint — called by Rasa action server, not public.
Routes: /internal/operators/reset-status, /internal/operators/available,
        /internal/queue/enqueue
"""
from flask import Blueprint
from web.api.impl import operator as _op

bp = Blueprint('internal', __name__)


@bp.route('/internal/operators/reset-status', methods=['GET'])
def internal_reset_operator_status():
    return _op.internal_reset_operator_status()


@bp.route('/internal/operators/available', methods=['GET'])
def internal_operators_available():
    return _op.internal_operators_available()


@bp.route('/internal/queue/enqueue', methods=['POST'])
def internal_queue_enqueue():
    return _op.internal_queue_enqueue()

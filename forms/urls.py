from django.urls import path
from .view.form_views import (
    dashboard_view,
    nuevo_afiliado_view,
    success_afiliado_view,
    actualizar_salario_view,
    cedula_por_persona_view,
)

app_name = "forms"

urlpatterns = [
    path("", dashboard_view, name="home"),
    path("dashboard/", dashboard_view, name="dashboard"),
    path("registrar-afiliado/", nuevo_afiliado_view, name="nuevo_afiliado"),
    path("actualizar-salario/", actualizar_salario_view, name="actualizar_salario"),
    path("api/cedula/", cedula_por_persona_view, name="cedula_por_persona"),
    path("exito-afiliado/", success_afiliado_view, name="success_afiliado"),
]

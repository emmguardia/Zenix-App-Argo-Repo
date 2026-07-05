{{/*
Labels communs Zenix App
*/}}
{{- define "zenix-app.labels" -}}
app.kubernetes.io/part-of: ZenixApp
{{- end -}}

{{- define "zenix-app.namespace" -}}
{{- .Values.namespace | default "zenix-app" -}}
{{- end -}}

{{- define "mesure-impact.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "mesure-impact.labels" -}}
app.kubernetes.io/name: {{ include "mesure-impact.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
{{- end -}}

{{- define "mesure-impact.image" -}}
{{- printf "%s/%s-%s:%s" .root.Values.image.registry (include "mesure-impact.name" .root) .component .root.Values.image.tag -}}
{{- end -}}

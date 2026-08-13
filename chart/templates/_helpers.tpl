{{- define "mesure-impact.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "mesure-impact.labels" -}}
app.kubernetes.io/name: {{ include "mesure-impact.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
{{- end -}}

{{/* Secret des tokens d'un produit — un par produit, scellé dans son dossier. */}}
{{- define "mesure-impact.secretName" -}}
{{- printf "%s-%s-%s-tokens" (include "mesure-impact.name" .root) .produit.departement .produit.nom -}}
{{- end -}}

{{- define "mesure-impact.image" -}}
{{- printf "%s/%s-%s:%s" .root.Values.image.registry (include "mesure-impact.name" .root) .component .root.Values.image.tag -}}
{{- end -}}

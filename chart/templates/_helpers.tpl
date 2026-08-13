{{- define "mesure-impact.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{/* Tag effectif : image.tag s'il est posé, sinon appVersion, que la CI fixe au
     sha du commit en publiant le chart. Le label de version doit lire CE tag, pas
     image.tag brut, sinon il est vide dès que le tag vient du chart. */}}
{{- define "mesure-impact.tag" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "mesure-impact.labels" -}}
app.kubernetes.io/name: {{ include "mesure-impact.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ include "mesure-impact.tag" . | quote }}
{{- end -}}

{{/* Secret des tokens d'un produit — un par produit, scellé dans son dossier. */}}
{{- define "mesure-impact.secretName" -}}
{{- printf "%s-%s-%s-tokens" (include "mesure-impact.name" .root) .produit.departement .produit.nom -}}
{{- end -}}

{{- define "mesure-impact.image" -}}
{{/* Le tag vient de appVersion, que la CI fixe au sha du commit en publiant le
     chart : chart et image sont ainsi épinglés par une seule version. `image.tag`
     ne reste qu'une échappatoire de déploiement local. */}}
{{- printf "%s/%s-%s:%s" .root.Values.image.registry (include "mesure-impact.name" .root) .component (include "mesure-impact.tag" .root) -}}
{{- end -}}

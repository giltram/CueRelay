"""One-way snapshot upgrade. Back up DB and stop writers before applying."""
from django.db import migrations


def upgrade(apps, schema_editor):
    from ass_format.migration import upgrade_legacy_document
    Project = apps.get_model('projects', 'Project')
    for project in Project.objects.using(schema_editor.connection.alias).select_for_update().order_by('pk').iterator(chunk_size=100):
        try:
            document = upgrade_legacy_document(project.document)
        except Exception as failure:
            raise RuntimeError(f'ASS v2 migration stopped at project {project.pk}; no data skipped') from failure
        Project.objects.using(schema_editor.connection.alias).filter(pk=project.pk).update(document=document)


class Migration(migrations.Migration):
    dependencies = [('projects', '0001_initial'), ('organizations', '0002_organizationstyletemplate')]
    operations = [migrations.RunPython(upgrade)]  # Deliberately irreversible; no lossy downgrade.

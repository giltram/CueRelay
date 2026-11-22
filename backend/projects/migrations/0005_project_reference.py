from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('projects', '0004_remove_project_glossary_auto_created')]
    operations = [
        migrations.AddField(model_name='project', name='reference_cues', field=models.JSONField(null=True, blank=True)),
        migrations.AddField(model_name='project', name='reference_version', field=models.PositiveBigIntegerField(default=1)),
        migrations.AddConstraint(model_name='project', constraint=models.CheckConstraint(
            condition=models.Q(reference_version__gte=1), name='positive_project_reference_version')),
    ]

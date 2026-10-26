"""Read-only compatibility check using the same validator as projects.0002."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from ass_format import AssError, serialize_ass
from ass_format.migration import upgrade_legacy_document
from projects.models import Project


class Command(BaseCommand):
    help = 'Check every project snapshot before the v2 style migration; never writes data.'

    def add_arguments(self, parser):
        parser.add_argument('--database', default='default', choices=tuple(connections))

    def handle(self, *args, **options):
        legacy_count = current_count = invalid_count = 0
        snapshots = Project.objects.using(options['database']).order_by('pk').values_list('pk', 'document')
        for project_id, document in snapshots.iterator(chunk_size=100):
            current = isinstance(document, dict) and document.get('schema_version') == 2
            try:
                if current:
                    serialize_ass(document)
                else:
                    upgrade_legacy_document(document)
            except AssError as error:
                invalid_count += 1
                # Report IDs and validation reasons, never source/cue contents.
                self.stdout.write(f'project {project_id}: {error}')
            else:
                if current:
                    current_count += 1
                else:
                    legacy_count += 1
        self.stdout.write(f'Compatible v1: {legacy_count}; valid v2: {current_count}; incompatible: {invalid_count}. No data changed.')
        if invalid_count:
            raise CommandError('Style migration blocked; resolve every reported project before migrate.')
